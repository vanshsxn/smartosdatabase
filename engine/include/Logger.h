#pragma once
// Logger.h — thread-safe ring buffer logger. Every log line is also mirrored
// to stdout so the API layer can persist it into job_execution_logs.

#include <deque>
#include <mutex>
#include <string>
#include <vector>

namespace mvcc {

enum class LogLevel { DEBUG, INFO, WARN, ERROR };

struct LogEntry {
    long long timestampMs;
    LogLevel level;
    std::string source;
    long long jobId;
    std::string message;
};

class Logger {
public:
    static Logger& instance();

    void log(LogLevel level, const std::string& source, long long jobId,
             const std::string& message);
    void info(const std::string& src, long long jobId, const std::string& m) {
        log(LogLevel::INFO, src, jobId, m);
    }
    void warn(const std::string& src, long long jobId, const std::string& m) {
        log(LogLevel::WARN, src, jobId, m);
    }
    void error(const std::string& src, long long jobId, const std::string& m) {
        log(LogLevel::ERROR, src, jobId, m);
    }

    std::vector<LogEntry> tail(size_t n, long long jobId = -1) const;
    static std::string levelName(LogLevel l);

private:
    Logger() = default;
    mutable std::mutex mutex_;
    std::deque<LogEntry> entries_;
    size_t capacity_ = 2000;
};

}  // namespace mvcc
