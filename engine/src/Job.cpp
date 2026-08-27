#include "Job.h"

namespace mvcc {

long long nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now().time_since_epoch())
        .count();
}

std::string toString(JobStatus s) {
    switch (s) {
        case JobStatus::QUEUED: return "QUEUED";
        case JobStatus::READY: return "READY";
        case JobStatus::RUNNING: return "RUNNING";
        case JobStatus::PAUSED: return "PAUSED";
        case JobStatus::COMPLETED: return "COMPLETED";
        case JobStatus::FAILED: return "FAILED";
        case JobStatus::CANCELLED: return "CANCELLED";
    }
    return "QUEUED";
}

std::string toString(Priority p) {
    switch (p) {
        case Priority::CRITICAL: return "CRITICAL";
        case Priority::HIGH: return "HIGH";
        case Priority::MEDIUM: return "MEDIUM";
        case Priority::LOW: return "LOW";
    }
    return "MEDIUM";
}

JobStatus jobStatusFromString(const std::string& s) {
    if (s == "READY") return JobStatus::READY;
    if (s == "RUNNING") return JobStatus::RUNNING;
    if (s == "PAUSED") return JobStatus::PAUSED;
    if (s == "COMPLETED") return JobStatus::COMPLETED;
    if (s == "FAILED") return JobStatus::FAILED;
    if (s == "CANCELLED") return JobStatus::CANCELLED;
    return JobStatus::QUEUED;
}

Priority priorityFromString(const std::string& s) {
    if (s == "CRITICAL") return Priority::CRITICAL;
    if (s == "HIGH") return Priority::HIGH;
    if (s == "LOW") return Priority::LOW;
    return Priority::MEDIUM;
}

int priorityWeight(Priority p) {
    switch (p) {
        case Priority::CRITICAL: return 4;
        case Priority::HIGH: return 3;
        case Priority::MEDIUM: return 2;
        case Priority::LOW: return 1;
    }
    return 2;
}

double Job::estimatedCredits() const {
    double seconds = static_cast<double>(estimatedMs) / 1000.0;
    double memGb = static_cast<double>(requestedMemoryMb) / 1024.0;
    return requestedCores * 0.5 * seconds + memGb * 0.25 * seconds;
}

double Job::chargedCredits(long long durationMs) const {
    double seconds = static_cast<double>(durationMs) / 1000.0;
    double memGb = static_cast<double>(requestedMemoryMb) / 1024.0;
    return requestedCores * 0.5 * seconds + memGb * 0.25 * seconds;
}

}  // namespace mvcc
