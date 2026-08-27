#pragma once
// MLFQScheduler.h — Multi Level Feedback Queue.
//
//   Queue 0 -> CRITICAL  quantum  40 ms
//   Queue 1 -> HIGH      quantum  80 ms
//   Queue 2 -> MEDIUM    quantum 160 ms
//   Queue 3 -> LOW       quantum 320 ms
//
// Policy:
//  * a new job enters the queue matching its priority class;
//  * a job that consumes its whole quantum is demoted one level (CPU bound);
//  * a job that yields before the quantum expires keeps its level (I/O bound);
//  * aging: a job waiting longer than kAgingMs is promoted one level so that
//    low priority work cannot starve.

#include <mutex>

#include "JobQueue.h"
#include "Scheduler.h"

namespace mvcc {

class MLFQScheduler : public Scheduler {
public:
    static constexpr int kLevels = 4;
    static constexpr long long kAgingMs = 4000;

    const char* name() const override { return "MLFQ"; }

    void enqueue(long long jobId) override;
    bool remove(long long jobId) override;
    SchedulingDecision selectNext(const AdmissionCheck& admit) override;
    void onQuantumExpired(long long jobId, long long usedMs) override;
    std::map<int, std::vector<long long>> queues() const override;
    int timeQuantumMs(int level) const override;
    size_t pending() const override;

private:
    void age();  // caller must hold mutex_

    mutable std::mutex mutex_;
    JobQueue levels_[kLevels];
};

}  // namespace mvcc
