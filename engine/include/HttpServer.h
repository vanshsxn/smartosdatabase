#pragma once
// HttpServer.h — minimal HTTP/1.1 server built directly on BSD sockets.
//
// COMPUTER NETWORKS: this is the TCP/IP boundary of the engine. We create an
// AF_INET stream socket, set SO_REUSEADDR, bind to a port, listen with a
// backlog and accept() connections. Each accepted connection is handled on a
// thread-pool worker; the request line, headers and Content-Length body are
// parsed manually and a JSON response is written back with an explicit
// Connection: close.

#include <functional>
#include <map>
#include <string>

namespace mvcc {

struct HttpRequest {
    std::string method;
    std::string path;
    std::map<std::string, std::string> query;
    std::map<std::string, std::string> headers;
    std::string body;
    std::string peer;
};

struct HttpResponse {
    int status = 200;
    std::string contentType = "application/json";
    std::string body;
};

using HttpHandler = std::function<HttpResponse(const HttpRequest&)>;

class HttpServer {
public:
    HttpServer(int port, int workerThreads);
    ~HttpServer();

    void route(const std::string& method, const std::string& path, HttpHandler handler);
    bool start();   // blocking accept loop
    void stop();

private:
    void handleConnection(int fd, const std::string& peer);
    HttpResponse dispatch(const HttpRequest& req);

    int port_;
    int workers_;
    int listenFd_ = -1;
    bool running_ = false;
    std::map<std::string, HttpHandler> routes_;  // "GET /api/jobs"
};

}  // namespace mvcc
