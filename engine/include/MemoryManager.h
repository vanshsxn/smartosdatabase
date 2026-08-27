#pragma once
// MemoryManager.h — simulated physical memory with BEST-FIT allocation.
//
// Memory is modelled as an ordered list of blocks over a contiguous address
// space. allocate() scans every free block and picks the smallest one that is
// big enough (best fit), splitting it when necessary. free() releases a block
// and coalesces it with free neighbours.
//
// SYNCHRONISATION: allocations happen from worker threads of the thread pool
// and from the scheduler thread, so the block list is guarded by a mutex.

#include <mutex>
#include <string>
#include <vector>

namespace mvcc {

struct MemoryBlock {
    long long base = 0;
    long long sizeMb = 0;
    bool free = true;
    long long ownerJobId = -1;
    std::string ownerName;
};

struct MemoryStats {
    long long totalMb = 0;
    long long usedMb = 0;
    long long freeMb = 0;
    double utilization = 0.0;      // percentage
    double fragmentation = 0.0;    // 1 - largestFree/totalFree, percentage
    long long largestFreeMb = 0;
    int freeBlocks = 0;
    int usedBlocks = 0;
    long long allocationCount = 0;
    long long failedAllocations = 0;
};

class MemoryManager {
public:
    explicit MemoryManager(long long totalMb = 16384);

    // Returns base address (>= 0) or -1 when no block fits.
    long long allocate(long long sizeMb, long long jobId, const std::string& jobName,
                       std::string& detail);
    bool release(long long jobId);

    MemoryStats stats() const;
    std::vector<MemoryBlock> blocks() const;
    std::string lastDecision() const;
    void reset();

private:
    void coalesce();  // caller holds mutex_

    mutable std::mutex mutex_;
    long long totalMb_;
    std::vector<MemoryBlock> blocks_;
    long long allocations_ = 0;
    long long failures_ = 0;
    std::string lastDecision_;
};

}  // namespace mvcc
