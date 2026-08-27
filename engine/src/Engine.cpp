#include "Engine.h"

#include <algorithm>
#include <chrono>
#include <sstream>
#include <thread>

#include "Logger.h"

namespace mvcc {

Engine::Engine(EngineConfig cfg)
    : cfg_(std::move(cfg)),
      memory_(cfg_.memoryMb),
      resources_(cfg_.cores, &memory_),
      pool_(cfg_.workers),
      policyName_(cfg_.policy) {
    mlfq_ = std::make_unique<MLFQScheduler>();

    ResourceSnapshotFn probe;
    probe.probe = [this](int& freeCores, int& totalCores, long long& freeMem, long long& totalMem) {
        ResourceSnapshot s = resources_.snapshot();
        freeCores = s.freeCores;
        totalCores = s.totalCores;
        freeMem = s.freeMemoryMb;
        totalMem = s.totalMemoryMb;
    };
    adaptive_ = std::make_unique<AdaptiveScheduler>(probe);
    adaptive_->setCreditProbe([this](const std::string& tenant) { return tenantCredits(tenant); });

    JobLookup lookup = [this](long long id) -> Job* {
        auto it = jobs_.find(id);
        return it == jobs_.end() ? nullptr : &it->second;
    };
    mlfq_->setLookup(lookup);
    adaptive_->setLookup(lookup);
}

Engine::~Engine() { stop(); }

Scheduler* Engine::activeScheduler() const {
    return policyName_ == "ADAPTIVE" ? static_cast<Scheduler*>(adaptive_.get())
                                     : static_cast<Scheduler*>(mlfq_.get());
}

void Engine::start() {
    if (running_.exchange(true)) return;
    startedAtMs_ = nowMs();
    dispatcher_ = std::thread([this] { dispatchLoop(); });
    Logger::instance().info("engine", -1,
                            "Engine started with " + std::to_string(cfg_.cores) + " cores, " +
                                std::to_string(cfg_.memoryMb) + " MB memory, " +
                                std::to_string(cfg_.workers) + " workers, policy " + policyName_);
}

void Engine::stop() {
    if (!running_.exchange(false)) return;
    if (dispatcher_.joinable()) dispatcher_.join();
    pool_.shutdown();
    Logger::instance().info("engine", -1, "Engine stopped");
}

SubmitResult Engine::submit(Job job) {
    SubmitResult res;
    std::string why;
    if (!resources_.canAdmit(job.requestedCores, job.requestedMemoryMb, why)) {
        // Still accepted, but it will wait in the ready queue until resources free up.
        Logger::instance().warn("engine", job.id, "Admission deferred: " + why);
    }
    if (job.requestedCores > cfg_.cores) {
        res.message = "Job requests " + std::to_string(job.requestedCores) + " cores but only " +
                      std::to_string(cfg_.cores) + " exist";
        return res;
    }
    if (job.requestedMemoryMb > cfg_.memoryMb) {
        res.message = "Job requests more memory than the node owns";
        return res;
    }

    job.id = nextId_.fetch_add(1);
    job.submittedAtMs = nowMs();
    job.lastEnqueuedAtMs = job.submittedAtMs;
    job.remainingMs = job.estimatedMs;
    job.status = JobStatus::QUEUED;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        jobs_[job.id] = job;
    }
    activeScheduler()->enqueue(job.id);
    Logger::instance().info("scheduler", job.id,
                            "Job '" + job.name + "' queued (" + toString(job.priority) +
                                ", burst " + std::to_string(job.estimatedMs) + " ms)");
    res.accepted = true;
    res.jobId = job.id;
    res.message = "queued";
    return res;
}

bool Engine::cancel(long long jobId, std::string& message) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = jobs_.find(jobId);
    if (it == jobs_.end()) {
        message = "unknown job";
        return false;
    }
    Job& job = it->second;
    if (job.status == JobStatus::COMPLETED || job.status == JobStatus::CANCELLED ||
        job.status == JobStatus::FAILED) {
        message = "job already finished";
        return false;
    }
    job.status = JobStatus::CANCELLED;
    job.completedAtMs = nowMs();
    activeScheduler()->remove(jobId);
    resources_.release(jobId);
    message = "cancelled";
    Logger::instance().warn("engine", jobId, "Job cancelled by user");
    return true;
}

bool Engine::getJob(long long jobId, Job& out) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = jobs_.find(jobId);
    if (it == jobs_.end()) return false;
    out = it->second;
    return true;
}

std::vector<Job> Engine::jobs(const std::string& tenantId, size_t limit) const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<Job> out;
    for (const auto& [id, job] : jobs_) {
        if (!tenantId.empty() && job.tenantId != tenantId) continue;
        out.push_back(job);
    }
    std::sort(out.begin(), out.end(),
              [](const Job& a, const Job& b) { return a.submittedAtMs > b.submittedAtMs; });
    if (out.size() > limit) out.resize(limit);
    return out;
}

void Engine::setPolicy(const std::string& policy) {
    std::string next = policy == "ADAPTIVE" ? "ADAPTIVE" : "MLFQ";
    if (next == policyName_) return;
    Scheduler* from = activeScheduler();
    std::vector<long long> pending;
    for (const auto& [level, ids] : from->queues()) {
        (void)level;
        for (long long id : ids) pending.push_back(id);
    }
    for (long long id : pending) from->remove(id);
    policyName_ = next;
    Scheduler* to = activeScheduler();
    for (long long id : pending) to->enqueue(id);
    Logger::instance().info("scheduler", -1,
                            "Policy switched to " + next + ", migrated " +
                                std::to_string(pending.size()) + " ready jobs");
}

std::string Engine::policy() const { return policyName_; }

void Engine::setPaused(bool paused) {
    if (paused_.exchange(paused) == paused) return;
    Logger::instance().warn("engine", -1, paused ? "Dispatcher paused by operator"
                                                 : "Dispatcher resumed by operator");
}

void Engine::dispatchLoop() {
    Logger::instance().info("dispatcher", -1, "Dispatcher loop online");
    while (running_.load()) {
        if (paused_.load()) {
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
            continue;
        }
        Scheduler* sched = activeScheduler();

        AdmissionCheck admit = [this](const Job& job, std::string& why) {
            return resources_.canAdmit(job.requestedCores, job.requestedMemoryMb, why);
        };

        SchedulingDecision decision;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            decision = sched->selectNext(admit);
        }

        if (decision.jobId < 0) {
            std::this_thread::sleep_for(std::chrono::milliseconds(25));
            continue;
        }

        long long quantum = sched->timeQuantumMs(decision.queueLevel);
        {
            std::lock_guard<std::mutex> lock(mutex_);
            decision.policy = sched->name();
            decisions_.push_back(decision);
            while (decisions_.size() > 200) decisions_.erase(decisions_.begin());
            auto it = jobs_.find(decision.jobId);
            if (it != jobs_.end()) {
                it->second.lastDecision = decision.reason;
                it->second.lastScore = decision.score;
            }
        }
        Logger::instance().info("scheduler", decision.jobId, decision.reason);

        long long jobId = decision.jobId;
        if (!pool_.submit([this, jobId, quantum] { execute(jobId, quantum); })) {
            std::lock_guard<std::mutex> lock(mutex_);
            activeScheduler()->enqueue(jobId);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
}

void Engine::execute(long long jobId, long long quantumMs) {
    Job snapshot;
    if (!getJob(jobId, snapshot)) return;
    if (snapshot.status == JobStatus::CANCELLED) return;

    std::string detail;
    bool acquired = resources_.acquire(jobId, snapshot.name, snapshot.requestedCores,
                                       snapshot.requestedMemoryMb, detail);
    if (!acquired) {
        Logger::instance().warn("resources", jobId, "Allocation failed: " + detail);
        std::lock_guard<std::mutex> lock(mutex_);
        activeScheduler()->enqueue(jobId);
        return;
    }
    Logger::instance().info("resources", jobId, detail);

    long long slice = 0;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = jobs_.find(jobId);
        if (it == jobs_.end()) {
            resources_.release(jobId);
            return;
        }
        Job& job = it->second;
        long long now = nowMs();
        job.waitingMs += now - job.lastEnqueuedAtMs;
        if (job.firstRunAtMs < 0) job.firstRunAtMs = now;
        if (job.startedAtMs < 0) job.startedAtMs = now;
        job.status = JobStatus::RUNNING;
        job.contextSwitches++;
        contextSwitches_.fetch_add(1);
        slice = std::min<long long>(quantumMs, job.remainingMs);
    }

    // Simulated CPU burst: the worker thread really sleeps for the slice so
    // that utilisation, throughput and turnaround numbers are measurable.
    std::this_thread::sleep_for(std::chrono::milliseconds(slice));
    busyCpuMs_.fetch_add(slice * snapshot.requestedCores);

    bool finished = false;
    bool preempted = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = jobs_.find(jobId);
        if (it == jobs_.end()) {
            resources_.release(jobId);
            return;
        }
        Job& job = it->second;
        if (job.status == JobStatus::CANCELLED) {
            resources_.release(jobId);
            return;
        }
        job.cpuTimeUsedMs += slice;
        job.remainingMs = std::max<long long>(0, job.remainingMs - slice);
        if (job.remainingMs == 0) {
            job.status = JobStatus::COMPLETED;
            job.completedAtMs = nowMs();
            job.creditsCharged = job.chargedCredits(job.cpuTimeUsedMs);
            finished = true;
        } else {
            job.status = JobStatus::READY;
            job.preemptions++;
            job.lastEnqueuedAtMs = nowMs();
            preemptions_.fetch_add(1);
            preempted = true;
        }
    }

    resources_.release(jobId);

    if (finished) {
        Job done;
        getJob(jobId, done);
        std::ostringstream oss;
        oss.setf(std::ios::fixed);
        oss.precision(2);
        oss << "Job completed in " << (done.completedAtMs - done.submittedAtMs)
            << " ms (CPU " << done.cpuTimeUsedMs << " ms, waited " << done.waitingMs
            << " ms, charged " << done.creditsCharged << " credits)";
        Logger::instance().info("engine", jobId, oss.str());
    } else if (preempted) {
        Logger::instance().info("scheduler", jobId,
                                "Quantum of " + std::to_string(slice) +
                                    " ms expired, requeued with " +
                                    std::to_string(snapshot.remainingMs - slice) + " ms left");
        std::lock_guard<std::mutex> lock(mutex_);
        activeScheduler()->onQuantumExpired(jobId, slice);
    }
}

SchedulerMetrics Engine::metrics() const {
    SchedulerMetrics m;
    long long waitSum = 0, turnSum = 0, respSum = 0, finishedCount = 0;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        for (const auto& [id, job] : jobs_) {
            switch (job.status) {
                case JobStatus::COMPLETED:
                    m.completed++;
                    finishedCount++;
                    waitSum += job.waitingMs;
                    turnSum += job.completedAtMs - job.submittedAtMs;
                    respSum += (job.firstRunAtMs >= 0 ? job.firstRunAtMs - job.submittedAtMs : 0);
                    break;
                case JobStatus::FAILED: m.failed++; break;
                case JobStatus::CANCELLED: m.cancelled++; break;
                case JobStatus::RUNNING: m.running++; break;
                default: m.queued++; break;
            }
        }
    }
    if (finishedCount > 0) {
        m.avgWaitingMs = static_cast<double>(waitSum) / finishedCount;
        m.avgTurnaroundMs = static_cast<double>(turnSum) / finishedCount;
        m.avgResponseMs = static_cast<double>(respSum) / finishedCount;
    }
    long long elapsed = std::max<long long>(1, nowMs() - startedAtMs_);
    m.throughputPerMin = static_cast<double>(m.completed) * 60000.0 / static_cast<double>(elapsed);
    m.cpuUtilization = std::min(
        100.0, static_cast<double>(busyCpuMs_.load()) * 100.0 /
                   (static_cast<double>(elapsed) * std::max(1, cfg_.cores)));
    m.contextSwitches = contextSwitches_.load();
    m.preemptions = preemptions_.load();
    return m;
}

ResourceSnapshot Engine::resources() const { return resources_.snapshot(); }

std::map<int, std::vector<long long>> Engine::queues() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return activeScheduler()->queues();
}

int Engine::quantumFor(int level) const { return activeScheduler()->timeQuantumMs(level); }

std::vector<SchedulingDecision> Engine::recentDecisions(size_t n) const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<SchedulingDecision> out;
    for (auto it = decisions_.rbegin(); it != decisions_.rend() && out.size() < n; ++it)
        out.push_back(*it);
    return out;
}

void Engine::setTenantCredits(const std::string& tenantId, double credits) {
    std::lock_guard<std::mutex> lock(creditsMutex_);
    credits_[tenantId] = credits;
}

double Engine::tenantCredits(const std::string& tenantId) const {
    std::lock_guard<std::mutex> lock(creditsMutex_);
    auto it = credits_.find(tenantId);
    return it == credits_.end() ? 1000.0 : it->second;
}

std::map<std::string, double> Engine::allTenantCredits() const {
    std::lock_guard<std::mutex> lock(creditsMutex_);
    return std::map<std::string, double>(credits_.begin(), credits_.end());
}

}  // namespace mvcc
