#include "MLFQScheduler.h"

#include <sstream>

#include "Logger.h"

namespace mvcc {

static int levelForPriority(Priority p) {
    switch (p) {
        case Priority::CRITICAL: return 0;
        case Priority::HIGH: return 1;
        case Priority::MEDIUM: return 2;
        case Priority::LOW: return 3;
    }
    return 2;
}

int MLFQScheduler::timeQuantumMs(int level) const {
    static const int quanta[kLevels] = {40, 80, 160, 320};
    if (level < 0) level = 0;
    if (level >= kLevels) level = kLevels - 1;
    return quanta[level];
}

void MLFQScheduler::enqueue(long long jobId) {
    std::lock_guard<std::mutex> lock(mutex_);
    int level = 2;
    if (lookup_) {
        if (Job* job = lookup_(jobId)) {
            level = job->queueLevel > 0 ? job->queueLevel : levelForPriority(job->priority);
            job->queueLevel = level;
            job->lastEnqueuedAtMs = nowMs();
            job->status = JobStatus::READY;
        }
    }
    if (level < 0) level = 0;
    if (level >= kLevels) level = kLevels - 1;
    levels_[level].push(jobId);
}

bool MLFQScheduler::remove(long long jobId) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (int i = 0; i < kLevels; ++i) {
        if (levels_[i].remove(jobId)) return true;
    }
    return false;
}

void MLFQScheduler::age() {
    if (!lookup_) return;
    long long now = nowMs();
    for (int level = kLevels - 1; level >= 1; --level) {
        for (long long id : levels_[level].snapshot()) {
            Job* job = lookup_(id);
            if (!job) continue;
            if (now - job->lastEnqueuedAtMs > kAgingMs) {
                levels_[level].remove(id);
                job->queueLevel = level - 1;
                job->lastEnqueuedAtMs = now;
                levels_[level - 1].push(id);
                Logger::instance().info("MLFQ", id,
                                        "Aging promotion to queue " + std::to_string(level - 1) +
                                            " after waiting > 4000 ms");
            }
        }
    }
}

SchedulingDecision MLFQScheduler::selectNext(const AdmissionCheck& admit) {
    std::lock_guard<std::mutex> lock(mutex_);
    age();
    SchedulingDecision d;
    d.policy = "MLFQ";
    for (int level = 0; level < kLevels; ++level) {
        for (long long id : levels_[level].snapshot()) {
            Job* job = lookup_ ? lookup_(id) : nullptr;
            if (!job) {
                levels_[level].remove(id);
                continue;
            }
            std::string why;
            if (admit && !admit(*job, why)) {
                continue;  // head-of-line job blocked: try the next one
            }
            levels_[level].remove(id);
            std::ostringstream oss;
            oss << "MLFQ picked job #" << id << " (" << job->name << ") from queue " << level
                << " [" << toString(job->priority) << "] with a " << timeQuantumMs(level)
                << " ms quantum; waited " << (nowMs() - job->lastEnqueuedAtMs) << " ms. " << why;
            d.jobId = id;
            d.queueLevel = level;
            d.score = static_cast<double>(kLevels - level);
            d.reason = oss.str();
            return d;
        }
    }
    return d;
}

void MLFQScheduler::onQuantumExpired(long long jobId, long long usedMs) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!lookup_) return;
    Job* job = lookup_(jobId);
    if (!job) return;
    int level = job->queueLevel;
    if (usedMs >= timeQuantumMs(level) && level < kLevels - 1) {
        job->queueLevel = level + 1;  // CPU bound -> demote
        Logger::instance().info("MLFQ", jobId,
                                "Used full quantum, demoted to queue " +
                                    std::to_string(job->queueLevel));
    }
    job->lastEnqueuedAtMs = nowMs();
    job->status = JobStatus::READY;
    levels_[job->queueLevel].push(jobId);
}

std::map<int, std::vector<long long>> MLFQScheduler::queues() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::map<int, std::vector<long long>> out;
    for (int i = 0; i < kLevels; ++i) out[i] = levels_[i].snapshot();
    return out;
}

size_t MLFQScheduler::pending() const {
    std::lock_guard<std::mutex> lock(mutex_);
    size_t n = 0;
    for (int i = 0; i < kLevels; ++i) n += levels_[i].size();
    return n;
}

}  // namespace mvcc
