#include "HttpServer.h"

// COMPUTER NETWORKS module: a hand written HTTP/1.1 server on top of the BSD
// socket API — socket(), setsockopt(SO_REUSEADDR), bind(), listen(), accept().
// Each connection is parsed manually (request line, headers, Content-Length
// body) and served on a thread-pool worker.

#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstring>
#include <sstream>

#include "Logger.h"
#include "ThreadPool.h"

namespace mvcc {
namespace {

std::string urlDecode(const std::string& in) {
    std::string out;
    for (size_t i = 0; i < in.size(); ++i) {
        if (in[i] == '%' && i + 2 < in.size()) {
            out.push_back(static_cast<char>(std::stoi(in.substr(i + 1, 2), nullptr, 16)));
            i += 2;
        } else if (in[i] == '+') {
            out.push_back(' ');
        } else {
            out.push_back(in[i]);
        }
    }
    return out;
}

std::string statusText(int code) {
    switch (code) {
        case 200: return "OK";
        case 201: return "Created";
        case 202: return "Accepted";
        case 400: return "Bad Request";
        case 404: return "Not Found";
        case 409: return "Conflict";
        case 500: return "Internal Server Error";
        default: return "OK";
    }
}

bool readRequest(int fd, HttpRequest& req) {
    std::string buffer;
    char chunk[4096];
    // 1. read until the end of the header block
    while (buffer.find("\r\n\r\n") == std::string::npos) {
        ssize_t n = ::recv(fd, chunk, sizeof(chunk), 0);
        if (n <= 0) return false;
        buffer.append(chunk, static_cast<size_t>(n));
        if (buffer.size() > 1 << 20) return false;
    }
    size_t headerEnd = buffer.find("\r\n\r\n");
    std::string head = buffer.substr(0, headerEnd);
    std::string body = buffer.substr(headerEnd + 4);

    std::istringstream hs(head);
    std::string line;
    std::getline(hs, line);
    if (!line.empty() && line.back() == '\r') line.pop_back();
    {
        std::istringstream ls(line);
        std::string target;
        ls >> req.method >> target;
        size_t q = target.find('?');
        if (q == std::string::npos) {
            req.path = target;
        } else {
            req.path = target.substr(0, q);
            std::istringstream qs(target.substr(q + 1));
            std::string pair;
            while (std::getline(qs, pair, '&')) {
                size_t eq = pair.find('=');
                if (eq == std::string::npos) continue;
                req.query[urlDecode(pair.substr(0, eq))] = urlDecode(pair.substr(eq + 1));
            }
        }
    }
    while (std::getline(hs, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        size_t colon = line.find(':');
        if (colon == std::string::npos) continue;
        std::string key = line.substr(0, colon);
        std::string value = line.substr(colon + 1);
        while (!value.empty() && value.front() == ' ') value.erase(value.begin());
        for (auto& c : key) c = static_cast<char>(::tolower(c));
        req.headers[key] = value;
    }

    // 2. keep reading until Content-Length bytes of body have arrived
    size_t contentLength = 0;
    auto it = req.headers.find("content-length");
    if (it != req.headers.end()) contentLength = static_cast<size_t>(std::stoul(it->second));
    while (body.size() < contentLength) {
        ssize_t n = ::recv(fd, chunk, sizeof(chunk), 0);
        if (n <= 0) break;
        body.append(chunk, static_cast<size_t>(n));
    }
    req.body = body;
    return true;
}

void writeResponse(int fd, const HttpResponse& res) {
    std::ostringstream oss;
    oss << "HTTP/1.1 " << res.status << " " << statusText(res.status) << "\r\n"
        << "Content-Type: " << res.contentType << "\r\n"
        << "Content-Length: " << res.body.size() << "\r\n"
        << "Access-Control-Allow-Origin: *\r\n"
        << "Access-Control-Allow-Headers: *\r\n"
        << "Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS\r\n"
        << "Connection: close\r\n\r\n"
        << res.body;
    std::string out = oss.str();
    size_t sent = 0;
    while (sent < out.size()) {
        ssize_t n = ::send(fd, out.data() + sent, out.size() - sent, 0);
        if (n <= 0) break;
        sent += static_cast<size_t>(n);
    }
}

}  // namespace

HttpServer::HttpServer(int port, int workerThreads) : port_(port), workers_(workerThreads) {}

HttpServer::~HttpServer() { stop(); }

void HttpServer::route(const std::string& method, const std::string& path, HttpHandler handler) {
    routes_[method + " " + path] = std::move(handler);
}

HttpResponse HttpServer::dispatch(const HttpRequest& req) {
    if (req.method == "OPTIONS") return HttpResponse{200, "text/plain", ""};

    auto exact = routes_.find(req.method + " " + req.path);
    if (exact != routes_.end()) return exact->second(req);

    // Parameterised routes: "/api/jobs/:id" matches "/api/jobs/1042".
    for (const auto& [key, handler] : routes_) {
        size_t space = key.find(' ');
        std::string method = key.substr(0, space);
        std::string pattern = key.substr(space + 1);
        if (method != req.method || pattern.find(':') == std::string::npos) continue;

        std::istringstream ps(pattern), rs(req.path);
        std::string pseg, rseg;
        HttpRequest copy = req;
        bool match = true;
        while (std::getline(ps, pseg, '/')) {
            if (!std::getline(rs, rseg, '/')) { match = false; break; }
            if (!pseg.empty() && pseg[0] == ':') {
                copy.query[pseg.substr(1)] = rseg;
            } else if (pseg != rseg) {
                match = false;
                break;
            }
        }
        if (match && !std::getline(rs, rseg, '/')) return handler(copy);
    }

    return HttpResponse{404, "application/json", R"({"error":"route not found"})"};
}

void HttpServer::handleConnection(int fd, const std::string& peer) {
    HttpRequest req;
    req.peer = peer;
    if (readRequest(fd, req)) {
        HttpResponse res;
        try {
            res = dispatch(req);
        } catch (const std::exception& e) {
            res = HttpResponse{500, "application/json",
                               std::string(R"({"error":")") + e.what() + "\"}"};
        }
        Logger::instance().log(LogLevel::DEBUG, "http", -1,
                               req.method + " " + req.path + " -> " + std::to_string(res.status) +
                                   " from " + peer);
        writeResponse(fd, res);
    }
    ::shutdown(fd, SHUT_WR);
    ::close(fd);
}

bool HttpServer::start() {
    listenFd_ = ::socket(AF_INET, SOCK_STREAM, 0);
    if (listenFd_ < 0) {
        Logger::instance().error("http", -1, "socket() failed");
        return false;
    }
    int yes = 1;
    ::setsockopt(listenFd_, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(static_cast<uint16_t>(port_));
    if (::bind(listenFd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        Logger::instance().error("http", -1, "bind() failed on port " + std::to_string(port_));
        return false;
    }
    if (::listen(listenFd_, 128) < 0) {
        Logger::instance().error("http", -1, "listen() failed");
        return false;
    }

    running_ = true;
    ThreadPool pool(static_cast<size_t>(workers_));
    Logger::instance().info("http", -1, "Engine API listening on 0.0.0.0:" + std::to_string(port_));

    while (running_) {
        sockaddr_in client{};
        socklen_t len = sizeof(client);
        int fd = ::accept(listenFd_, reinterpret_cast<sockaddr*>(&client), &len);
        if (fd < 0) {
            if (!running_) break;
            continue;
        }
        char ip[INET_ADDRSTRLEN]{};
        ::inet_ntop(AF_INET, &client.sin_addr, ip, sizeof(ip));
        std::string peer = std::string(ip) + ":" + std::to_string(ntohs(client.sin_port));
        int flag = 1;
        ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &flag, sizeof(flag));
        if (!pool.submit([this, fd, peer] { handleConnection(fd, peer); })) ::close(fd);
    }
    return true;
}

void HttpServer::stop() {
    running_ = false;
    if (listenFd_ >= 0) {
        ::shutdown(listenFd_, SHUT_RDWR);
        ::close(listenFd_);
        listenFd_ = -1;
    }
}

}  // namespace mvcc
