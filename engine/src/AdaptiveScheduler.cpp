#include "AdaptiveScheduler.h"

#include <algorithm>
#include <sstream>

#include "Logger.h"

namespace mvcc {

void AdaptiveScheduler::enqueue(long long jobId) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (lookup_) {
        if (Job* job = lookup_(jobId)) {
            job->lastEnqueuedAtMs = nowMs();
            job->status = JobStatus::READY;
            job->queueLevel = 4 - priorityWeight(job->priority);
        }
    }
    pool_.push_back(jobId);
}

bool AdaptiveScheduler::remove(long long jobId) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = std::find(pool_.begin(), pool_.end(), jobId);
    if (it == pool_.end()) return false;
    pool_.erase(it);
    return true;
}

double AdaptiveScheduler::scoreOf(const Job& job, std::string& explanation) const {
    int freeCores = 0, totalCores = 1;
    long long freeMem = 0, totalMem = 1;
    if (probe_.probe) probe_.probe(freeCores, totalCores, freeMem, totalMem);

    double priorityFactor = priorityWeight(job.priority) / 4.0;
    long long waited = nowMs() - job.lastEnqueuedAtMs;
    double agingFactor = std::min(1.0, static_cast<double>(waited) / 10000.0);

    double coreFit = totalCores > 0
                         ? std::max(0.0, (static_cast<double>(freeCores) - job.requestedCores + 1) /
                                             totalCores)
                         : 0.0;
    double memFit = totalMem > 0 ? std::max(0.0, static_cast<double>(freeMem - job.requestedMemoryMb) /
                                                     static_cast<double>(totalMem))
                                 : 0.0;
    double resourceFit = std::min(1.0, (coreFit + memFit) / 2.0);

    double shortJobFactor = 1.0 / (1.0 + static_cast<double>(job.remainingMs) / 1000.0);

    double credits = credits_ ? credits_(job.tenantId) : 1000.0;
    double needed = job.estimatedCredits();
    double creditFactor = needed <= 0 ? 1.0 : std::min(1.0, credits / (needed * 4.0));

    double score = w_.priority * priorityFactor + w_.aging * agingFactor +
                   w_.resourceFit * resourceFit + w_.shortJob * shortJobFactor +
                   w_.credits * creditFactor;

    std::ostringstream oss;
    oss.setf(std::ios::fixed);
    oss.precision(1);
    oss << "score " << score << " = priority " << toString(job.priority) << " ("
        << w_.priority * priorityFactor << ") + waited " << waited << " ms ("
        << w_.aging * agingFactor << ") + resource fit (" << w_.resourceFit * resourceFit
        << ") + short-job bias (" << w_.shortJob * shortJobFactor << ") + tenant credits ("
        << w_.credits * creditFactor << ")";
    explanation = oss.str();
    return score;
}

SchedulingDecision AdaptiveScheduler::selectNext(const AdmissionCheck& admit) {
    std::lock_guard<std::mutex> lock(mutex_);
    SchedulingDecision d;
    d.policy = "ADAPTIVE";
    double best = -1.0;
    long long bestId = -1;
    std::string bestExplanation, bestWhy;
    Job* bestJob = nullptr;

    for (long long id : pool_) {
        Job* job = lookup_ ? lookup_(id) : nullptr;
        if (!job) continue;
        std::string why;
        if (admit && !admit(*job, why)) continue;
        std::string explanation;
        double score = scoreOf(*job, explanation);
        job->lastScore = score;
        if (score > best) {
            best = score;
            bestId = id;
            bestExplanation = explanation;
            bestWhy = why;
            bestJob = job;
        }
    }

    if (bestId < 0) return d;
    pool_.erase(std::find(pool_.begin(), pool_.end(), bestId));

    std::ostringstream oss;
    oss << "Adaptive scheduler selected job #" << bestId << " (" << bestJob->name << "): "
        << bestExplanation << ". Admission: " << bestWhy;
    d.jobId = bestId;
    d.score = best;
    d.reason = oss.str();
    d.queueLevel = bestJob->queueLevel;
    return d;
}

void AdaptiveScheduler::onQuantumExpired(long long jobId, long long) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (lookup_) {
        if (Job* job = lookup_(jobId)) {
            job->lastEnqueuedAtMs = nowMs();
            job->status = JobStatus::READY;
        }
    }
    pool_.push_back(jobId);
}

std::map<int, std::vector<long long>> AdaptiveScheduler::queues() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::map<int, std::vector<long long>> out{{0, {}}, {1, {}}, {2, {}}, {3, {}}};
    for (long long id : pool_) {
        Job* job = lookup_ ? lookup_(id) : nullptr;
        int level = job ? std::min(3, std::max(0, job->queueLevel)) : 2;
        out[level].push_back(id);
    }
    return out;
}

int AdaptiveScheduler::timeQuantumMs(int level) const {
    static const int quanta[4] = {60, 120, 200, 300};
    if (level < 0) level = 0;
    if (level > 3) level = 3;
    return quanta[level];
}

size_t AdaptiveScheduler::pending() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return pool_.size();
}

}  // namespace mvcc
