#pragma once
// Scheduler.h — abstract scheduling policy interface.
// Both MLFQScheduler and AdaptiveScheduler implement this interface so the
// engine can hot-swap the active policy at runtime (/scheduler/policy).

#include <functional>
#include <map>
#include <string>
#include <vector>

#include "Job.h"

namespace mvcc {

struct SchedulingDecision {
    long long jobId = -1;
    double score = 0.0;
    std::string reason;
    std::string policy;
    int queueLevel = 0;
};

// Lookup callback so a policy can inspect live job data owned by the engine.
using JobLookup = std::function<Job*(long long)>;

// Resource probe: returns true when the job can currently be admitted.
using AdmissionCheck = std::function<bool(const Job&, std::string& why)>;

class Scheduler {
public:
    virtual ~Scheduler() = default;
    virtual const char* name() const = 0;

    virtual void enqueue(long long jobId) = 0;
    virtual bool remove(long long jobId) = 0;
    // Selects the next runnable job. Returns jobId < 0 when nothing is ready.
    virtual SchedulingDecision selectNext(const AdmissionCheck& admit) = 0;
    // Called back when a job yields after using `usedMs` of CPU time.
    virtual void onQuantumExpired(long long jobId, long long usedMs) = 0;
    virtual std::map<int, std::vector<long long>> queues() const = 0;
    virtual int timeQuantumMs(int level) const = 0;
    virtual size_t pending() const = 0;

protected:
    JobLookup lookup_;

public:
    void setLookup(JobLookup lookup) { lookup_ = std::move(lookup); }
};

}  // namespace mvcc
