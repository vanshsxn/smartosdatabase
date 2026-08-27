#pragma once
// Engine.h — orchestrator. Owns the job table, the active scheduling policy,
// the resource manager, the memory manager and the thread pool, and runs the
// dispatcher loop that turns scheduling decisions into executing jobs.

#include <atomic>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "AdaptiveScheduler.h"
#include "Job.h"
#include "MLFQScheduler.h"
#include "MemoryManager.h"
#include "ResourceManager.h"
#include "Scheduler.h"
#include "ThreadPool.h"

namespace mvcc {

struct EngineConfig {
    int cores = 8;
    long long memoryMb = 16384;
    size_t workers = 4;
    std::string policy = "MLFQ";
};

struct SchedulerMetrics {
    double avgWaitingMs = 0;
    double avgTurnaroundMs = 0;
    double avgResponseMs = 0;
    double cpuUtilization = 0;
    double throughputPerMin = 0;
    long long contextSwitches = 0;
    long long preemptions = 0;
    long long completed = 0;
    long long failed = 0;
    long long cancelled = 0;
    long long running = 0;
    long long queued = 0;
};

struct SubmitResult {
    bool accepted = false;
    long long jobId = -1;
    std::string message;
};

class Engine {
public:
    explicit Engine(EngineConfig cfg);
    ~Engine();

    void start();
    void stop();

    SubmitResult submit(Job job);
    bool cancel(long long jobId, std::string& message);
    bool getJob(long long jobId, Job& out) const;
    std::vector<Job> jobs(const std::string& tenantId = "", size_t limit = 200) const;

    void setPolicy(const std::string& policy);
    std::string policy() const;

    // Dispatcher pause/resume — lets operators freeze scheduling from the UI.
    void setPaused(bool paused);
    bool paused() const { return paused_.load(); }

    SchedulerMetrics metrics() const;
    ResourceSnapshot resources() const;
    MemoryStats memory() const { return memory_.stats(); }
    std::vector<MemoryBlock> memoryBlocks() const { return memory_.blocks(); }
    std::map<int, std::vector<long long>> queues() const;
    int quantumFor(int level) const;
    ThreadPool& pool() { return pool_; }
    const ThreadPool& pool() const { return pool_; }
    std::vector<SchedulingDecision> recentDecisions(size_t n) const;

    // Tenant credit ledger mirrored from PostgreSQL by the API layer.
    void setTenantCredits(const std::string& tenantId, double credits);
    double tenantCredits(const std::string& tenantId) const;
    std::map<std::string, double> allTenantCredits() const;

private:
    void dispatchLoop();
    void execute(long long jobId, long long quantumMs);
    Scheduler* activeScheduler() const;

    EngineConfig cfg_;
    MemoryManager memory_;
    ResourceManager resources_;
    ThreadPool pool_;
    std::unique_ptr<MLFQScheduler> mlfq_;
    std::unique_ptr<AdaptiveScheduler> adaptive_;

    mutable std::mutex mutex_;                       // guards jobs_/credits_/decisions_
    std::unordered_map<long long, Job> jobs_;
    mutable std::mutex creditsMutex_;               // separate: read from scheduler scoring
    std::unordered_map<std::string, double> credits_;
    std::vector<SchedulingDecision> decisions_;
    std::atomic<long long> nextId_{1000};
    std::atomic<bool> running_{false};
    std::atomic<bool> paused_{false};
    std::atomic<long long> contextSwitches_{0};
    std::atomic<long long> preemptions_{0};
    std::atomic<long long> busyCpuMs_{0};
    long long startedAtMs_ = 0;
    std::string policyName_;
    std::thread dispatcher_;
};

}  // namespace mvcc
