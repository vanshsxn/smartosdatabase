#pragma once
// ResourceManager.h — admission control for CPU cores and memory.
//
// Implements a counting-semaphore style allocation: a job is admitted only if
// enough cores AND enough memory are free. Allocation and release are atomic
// with respect to each other (single mutex) which prevents the classic
// lost-update race when several worker threads finish at the same time.

#include <mutex>
#include <string>
#include <unordered_map>

#include "MemoryManager.h"

namespace mvcc {

struct ResourceSnapshot {
    int totalCores = 0;
    int usedCores = 0;
    int freeCores = 0;
    double cpuUtilization = 0.0;
    long long totalMemoryMb = 0;
    long long usedMemoryMb = 0;
    long long freeMemoryMb = 0;
    double memoryUtilization = 0.0;
    int activeAllocations = 0;
};

class ResourceManager {
public:
    ResourceManager(int cores, MemoryManager* memory);

    bool canAdmit(int cores, long long memoryMb, std::string& why) const;
    // Reserves cores + best-fit memory block. Returns false and leaves the
    // system untouched when either resource is unavailable.
    bool acquire(long long jobId, const std::string& jobName, int cores, long long memoryMb,
                 std::string& detail);
    void release(long long jobId);

    ResourceSnapshot snapshot() const;
    int totalCores() const { return totalCores_; }

private:
    struct Reservation {
        int cores;
        long long memoryMb;
    };

    mutable std::mutex mutex_;
    int totalCores_;
    int usedCores_ = 0;
    MemoryManager* memory_;
    std::unordered_map<long long, Reservation> reservations_;
};

}  // namespace mvcc
