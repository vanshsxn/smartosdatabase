#include "Logger.h"

#include <cstdio>

#include "Job.h"

namespace mvcc {

Logger& Logger::instance() {
    static Logger logger;
    return logger;
}

std::string Logger::levelName(LogLevel l) {
    switch (l) {
        case LogLevel::DEBUG: return "DEBUG";
        case LogLevel::INFO: return "INFO";
        case LogLevel::WARN: return "WARN";
        case LogLevel::ERROR: return "ERROR";
    }
    return "INFO";
}

void Logger::log(LogLevel level, const std::string& source, long long jobId,
                 const std::string& message) {
    LogEntry entry{nowMs(), level, source, jobId, message};
    {
        std::lock_guard<std::mutex> lock(mutex_);
        entries_.push_back(entry);
        while (entries_.size() > capacity_) entries_.pop_front();
    }
    std::printf("[%s] %-16s job=%lld %s\n", levelName(level).c_str(), source.c_str(), jobId,
                message.c_str());
    std::fflush(stdout);
}

std::vector<LogEntry> Logger::tail(size_t n, long long jobId) const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<LogEntry> out;
    for (auto it = entries_.rbegin(); it != entries_.rend() && out.size() < n; ++it) {
        if (jobId >= 0 && it->jobId != jobId) continue;
        out.push_back(*it);
    }
    return out;
}

}  // namespace mvcc
