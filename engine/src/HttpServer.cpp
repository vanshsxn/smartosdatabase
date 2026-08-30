#include "HttpServer.h"

// SmartDatabaseOS
// C++ HTTP/1.1 server used as the backend for the OS core engine.
//
// Networking concepts demonstrated:
// - BSD sockets
// - TCP
// - socket()
// - setsockopt()
// - bind()
// - listen()
// - accept()
// - recv()
// - send()
// - ThreadPool based request handling
//
// Deployment:
// - Uses the PORT environment variable when available.
// - Falls back to port 8080 for local development.

#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cctype>
#include <cstdlib>
#include <cstring>
#include <sstream>
#include <stdexcept>

#include "Logger.h"
#include "ThreadPool.h"

namespace mvcc {

namespace {

// ------------------------------------------------------------
// URL decoding
// ------------------------------------------------------------

std::string urlDecode(const std::string& in) {
    std::string out;
    out.reserve(in.size());

    for (size_t i = 0; i < in.size(); ++i) {
        if (in[i] == '%' && i + 2 < in.size()) {
            try {
                const int value =
                    std::stoi(in.substr(i + 1, 2), nullptr, 16);

                out.push_back(static_cast<char>(value));
                i += 2;
            } catch (...) {
                // Invalid percent encoding.
                out.push_back(in[i]);
            }
        } else if (in[i] == '+') {
            out.push_back(' ');
        } else {
            out.push_back(in[i]);
        }
    }

    return out;
}

// ------------------------------------------------------------
// HTTP status text
// ------------------------------------------------------------

std::string statusText(int code) {
    switch (code) {
        case 200:
            return "OK";

        case 201:
            return "Created";

        case 202:
            return "Accepted";

        case 204:
            return "No Content";

        case 400:
            return "Bad Request";

        case 401:
            return "Unauthorized";

        case 403:
            return "Forbidden";

        case 404:
            return "Not Found";

        case 409:
            return "Conflict";

        case 500:
            return "Internal Server Error";

        case 502:
            return "Bad Gateway";

        case 503:
            return "Service Unavailable";

        default:
            return "OK";
    }
}

// ------------------------------------------------------------
// Read HTTP request
// ------------------------------------------------------------

bool readRequest(int fd, HttpRequest& req) {
    std::string buffer;

    char chunk[4096];

    // Maximum header size: 1 MB.
    constexpr size_t MAX_HEADER_SIZE = 1 << 20;

    // --------------------------------------------------------
    // 1. Read until HTTP headers end.
    // --------------------------------------------------------

    while (buffer.find("\r\n\r\n") == std::string::npos) {
        ssize_t n = ::recv(fd, chunk, sizeof(chunk), 0);

        if (n <= 0) {
            return false;
        }

        buffer.append(chunk, static_cast<size_t>(n));

        if (buffer.size() > MAX_HEADER_SIZE) {
            return false;
        }
    }

    const size_t headerEnd = buffer.find("\r\n\r\n");

    std::string head = buffer.substr(0, headerEnd);

    std::string body = buffer.substr(headerEnd + 4);

    // --------------------------------------------------------
    // 2. Parse request line.
    // --------------------------------------------------------

    std::istringstream hs(head);

    std::string line;

    if (!std::getline(hs, line)) {
        return false;
    }

    if (!line.empty() && line.back() == '\r') {
        line.pop_back();
    }

    {
        std::istringstream ls(line);

        std::string target;
        std::string version;

        if (!(ls >> req.method >> target >> version)) {
            return false;
        }

        // ----------------------------------------------------
        // Separate path and query string.
        // ----------------------------------------------------

        const size_t q = target.find('?');

        if (q == std::string::npos) {
            req.path = target;
        } else {
            req.path = target.substr(0, q);

            std::istringstream qs(target.substr(q + 1));

            std::string pair;

            while (std::getline(qs, pair, '&')) {
                const size_t eq = pair.find('=');

                if (eq == std::string::npos) {
                    continue;
                }

                const std::string key =
                    urlDecode(pair.substr(0, eq));

                const std::string value =
                    urlDecode(pair.substr(eq + 1));

                req.query[key] = value;
            }
        }
    }

    // --------------------------------------------------------
    // 3. Parse headers.
    // --------------------------------------------------------

    while (std::getline(hs, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }

        const size_t colon = line.find(':');

        if (colon == std::string::npos) {
            continue;
        }

        std::string key = line.substr(0, colon);

        std::string value = line.substr(colon + 1);

        while (!value.empty() && value.front() == ' ') {
            value.erase(value.begin());
        }

        for (char& c : key) {
            c = static_cast<char>(
                std::tolower(static_cast<unsigned char>(c))
            );
        }

        req.headers[key] = value;
    }

    // --------------------------------------------------------
    // 4. Read request body using Content-Length.
    // --------------------------------------------------------

    size_t contentLength = 0;

    auto it = req.headers.find("content-length");

    if (it != req.headers.end()) {
        try {
            contentLength =
                static_cast<size_t>(std::stoull(it->second));
        } catch (...) {
            return false;
        }
    }

    // Prevent accidentally accepting enormous request bodies.
    constexpr size_t MAX_BODY_SIZE = 10 << 20; // 10 MB

    if (contentLength > MAX_BODY_SIZE) {
        return false;
    }

    while (body.size() < contentLength) {
        ssize_t n =
            ::recv(fd, chunk, sizeof(chunk), 0);

        if (n <= 0) {
            return false;
        }

        body.append(chunk, static_cast<size_t>(n));
    }

    // If recv() received more than Content-Length, only keep
    // the declared body.
    if (body.size() > contentLength) {
        body.resize(contentLength);
    }

    req.body = body;

    return true;
}

// ------------------------------------------------------------
// Send HTTP response
// ------------------------------------------------------------

void writeResponse(int fd, const HttpResponse& res) {
    std::ostringstream oss;

    oss
        << "HTTP/1.1 "
        << res.status
        << " "
        << statusText(res.status)
        << "\r\n"

        << "Content-Type: "
        << res.contentType
        << "\r\n"

        << "Content-Length: "
        << res.body.size()
        << "\r\n"

        // CORS
        << "Access-Control-Allow-Origin: *\r\n"
        << "Access-Control-Allow-Headers: *\r\n"
        << "Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS\r\n"

        // Helpful for proxies.
        << "Cache-Control: no-store\r\n"

        << "Connection: close\r\n"

        << "\r\n"

        << res.body;

    const std::string out = oss.str();

    size_t sent = 0;

    while (sent < out.size()) {
        ssize_t n =
            ::send(
                fd,
                out.data() + sent,
                out.size() - sent,
                0
            );

        if (n <= 0) {
            break;
        }

        sent += static_cast<size_t>(n);
    }
}

}  // namespace

// ============================================================
// HttpServer
// ============================================================

HttpServer::HttpServer(
    int port,
    int workerThreads
)
    : port_(port),
      workers_(workerThreads) {}

HttpServer::~HttpServer() {
    stop();
}

// ============================================================
// Register route
// ============================================================

void HttpServer::route(
    const std::string& method,
    const std::string& path,
    HttpHandler handler
) {
    routes_[method + " " + path] =
        std::move(handler);
}

// ============================================================
// Dispatch request
// ============================================================

HttpResponse HttpServer::dispatch(
    const HttpRequest& req
) {
    // --------------------------------------------------------
    // CORS preflight
    // --------------------------------------------------------

    if (req.method == "OPTIONS") {
        return HttpResponse{
            204,
            "text/plain",
            ""
        };
    }

    // --------------------------------------------------------
    // Exact route
    // --------------------------------------------------------

    auto exact =
        routes_.find(
            req.method + " " + req.path
        );

    if (exact != routes_.end()) {
        return exact->second(req);
    }

    // --------------------------------------------------------
    // Parameterized routes.
    //
    // Example:
    //
    // /api/jobs/:id
    //
    // matches:
    //
    // /api/jobs/1042
    // --------------------------------------------------------

    for (const auto& [key, handler] : routes_) {
        const size_t space = key.find(' ');

        if (space == std::string::npos) {
            continue;
        }

        const std::string method =
            key.substr(0, space);

        const std::string pattern =
            key.substr(space + 1);

        if (
            method != req.method ||
            pattern.find(':') == std::string::npos
        ) {
            continue;
        }

        std::istringstream ps(pattern);
        std::istringstream rs(req.path);

        std::string pseg;
        std::string rseg;

        HttpRequest copy = req;

        bool match = true;

        while (std::getline(ps, pseg, '/')) {
            if (!std::getline(rs, rseg, '/')) {
                match = false;
                break;
            }

            if (
                !pseg.empty() &&
                pseg[0] == ':'
            ) {
                copy.query[
                    pseg.substr(1)
                ] = rseg;
            } else if (pseg != rseg) {
                match = false;
                break;
            }
        }

        if (
            match &&
            !std::getline(rs, rseg, '/')
        ) {
            return handler(copy);
        }
    }

    return HttpResponse{
        404,
        "application/json",
        R"({"error":"route not found"})"
    };
}

// ============================================================
// Handle one TCP connection
// ============================================================

void HttpServer::handleConnection(
    int fd,
    const std::string& peer
) {
    HttpRequest req;

    req.peer = peer;

    if (readRequest(fd, req)) {
        HttpResponse res;

        try {
            res = dispatch(req);
        } catch (const std::exception& e) {
            std::string error = e.what();

            // Basic JSON-safe error.
            for (char& c : error) {
                if (c == '"') {
                    c = '\'';
                }
            }

            res = HttpResponse{
                500,
                "application/json",
                std::string(
                    R"({"error":")"
                ) +
                    error +
                    R"("})"
            };
        }

        Logger::instance().log(
            LogLevel::DEBUG,
            "http",
            -1,
            req.method +
                " " +
                req.path +
                " -> " +
                std::to_string(res.status) +
                " from " +
                peer
        );

        writeResponse(fd, res);
    }

    ::shutdown(fd, SHUT_WR);

    ::close(fd);
}

// ============================================================
// Start HTTP server
// ============================================================

bool HttpServer::start() {

    // --------------------------------------------------------
    // IMPORTANT FOR RENDER
    //
    // Render provides the PORT environment variable.
    //
    // Example:
    //
    // PORT=10000
    //
    // We use that value instead of assuming 8080.
    // --------------------------------------------------------

    const char* renderPort =
        std::getenv("PORT");

    if (
        renderPort != nullptr &&
        std::strlen(renderPort) > 0
    ) {
        try {
            port_ = std::stoi(renderPort);
        } catch (...) {
            Logger::instance().error(
                "http",
                -1,
                "Invalid PORT environment variable"
            );

            return false;
        }
    }

    // Local fallback.
    if (port_ <= 0 || port_ > 65535) {
        port_ = 8080;
    }

    // --------------------------------------------------------
    // Create TCP socket
    // --------------------------------------------------------

    listenFd_ =
        ::socket(
            AF_INET,
            SOCK_STREAM,
            0
        );

    if (listenFd_ < 0) {
        Logger::instance().error(
            "http",
            -1,
            "socket() failed"
        );

        return false;
    }

    // --------------------------------------------------------
    // Allow address reuse
    // --------------------------------------------------------

    int yes = 1;

    ::setsockopt(
        listenFd_,
        SOL_SOCKET,
        SO_REUSEADDR,
        &yes,
        sizeof(yes)
    );

    // --------------------------------------------------------
    // Bind to 0.0.0.0
    //
    // IMPORTANT:
    // This allows Render's network to reach the service.
    // --------------------------------------------------------

    sockaddr_in addr{};

    addr.sin_family =
        AF_INET;

    addr.sin_addr.s_addr =
        INADDR_ANY;

    addr.sin_port =
        htons(
            static_cast<uint16_t>(port_)
        );

    if (
        ::bind(
            listenFd_,
            reinterpret_cast<sockaddr*>(&addr),
            sizeof(addr)
        ) < 0
    ) {
        Logger::instance().error(
            "http",
            -1,
            "bind() failed on port " +
                std::to_string(port_)
        );

        ::close(listenFd_);
        listenFd_ = -1;

        return false;
    }

    // --------------------------------------------------------
    // Start listening
    // --------------------------------------------------------

    if (
        ::listen(
            listenFd_,
            128
        ) < 0
    ) {
        Logger::instance().error(
            "http",
            -1,
            "listen() failed"
        );

        ::close(listenFd_);
        listenFd_ = -1;

        return false;
    }

    running_ = true;

    ThreadPool pool(
        static_cast<size_t>(workers_)
    );

    Logger::instance().info(
        "http",
        -1,
        "SmartDatabaseOS Engine API listening on 0.0.0.0:" +
            std::to_string(port_)
    );

    // --------------------------------------------------------
    // Accept connections
    // --------------------------------------------------------

    while (running_) {

        sockaddr_in client{};

        socklen_t len =
            sizeof(client);

        int fd =
            ::accept(
                listenFd_,
                reinterpret_cast<sockaddr*>(&client),
                &len
            );

        if (fd < 0) {
            if (!running_) {
                break;
            }

            continue;
        }

        // ----------------------------------------------------
        // Get client IP
        // ----------------------------------------------------

        char ip[INET_ADDRSTRLEN]{};

        ::inet_ntop(
            AF_INET,
            &client.sin_addr,
            ip,
            sizeof(ip)
        );

        const std::string peer =
            std::string(ip) +
            ":" +
            std::to_string(
                ntohs(client.sin_port)
            );

        // ----------------------------------------------------
        // Disable Nagle algorithm.
        // ----------------------------------------------------

        int flag = 1;

        ::setsockopt(
            fd,
            IPPROTO_TCP,
            TCP_NODELAY,
            &flag,
            sizeof(flag)
        );

        // ----------------------------------------------------
        // Send connection to worker thread.
        // ----------------------------------------------------

        if (
            !pool.submit(
                [this, fd, peer] {
                    handleConnection(
                        fd,
                        peer
                    );
                }
            )
        ) {
            ::close(fd);
        }
    }

    return true;
}

// ============================================================
// Stop HTTP server
// ============================================================

void HttpServer::stop() {

    running_ = false;

    if (listenFd_ >= 0) {

        ::shutdown(
            listenFd_,
            SHUT_RDWR
        );

        ::close(listenFd_);

        listenFd_ = -1;
    }
}

}  // namespace mvcc