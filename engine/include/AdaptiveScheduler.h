#pragma once
// AdaptiveScheduler.h — score based scheduling.
//
// score = w1 * priorityFactor
//       + w2 * agingFactor          (waiting time, prevents starvation)
//       + w3 * resourceFitFactor    (how well the request fits free CPU/RAM)
//       + w4 * shortJobFactor       (SJF-like bias on estimated burst)
//       + w5 * creditFactor         (tenant must be able to pay)
//
// The job with the highest score that also passes the admission check is
// selected. The engine keeps the human readable explanation so the dashboard
// can display *why* a job was chosen.

#include <mutex>
#include <vector>

#include "Scheduler.h"

namespace mvcc {

struct ResourceSnapshotFn {
    // returns free cores / total cores / free memory / total memory
    std::function<void(int&, int&, long long&, long long&)> probe;
};

class AdaptiveScheduler : public Scheduler {
public:
    struct Weights {
        double priority = 40.0;
        double aging = 25.0;
        double resourceFit = 15.0;
        double shortJob = 12.0;
        double credits = 8.0;
    };

    explicit AdaptiveScheduler(ResourceSnapshotFn probe) : probe_(std::move(probe)) {}

    const char* name() const override { return "ADAPTIVE"; }

    void enqueue(long long jobId) override;
    bool remove(long long jobId) override;
    SchedulingDecision selectNext(const AdmissionCheck& admit) override;
    void onQuantumExpired(long long jobId, long long usedMs) override;
    std::map<int, std::vector<long long>> queues() const override;
    int timeQuantumMs(int level) const override;
    size_t pending() const override;

    void setCreditProbe(std::function<double(const std::string&)> fn) { credits_ = std::move(fn); }
    double scoreOf(const Job& job, std::string& explanation) const;

private:
    mutable std::mutex mutex_;
    std::vector<long long> pool_;
    ResourceSnapshotFn probe_;
    std::function<double(const std::string&)> credits_;
    Weights w_;
};

}  // namespace mvcc
