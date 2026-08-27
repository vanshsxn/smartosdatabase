#include "MemoryManager.h"

#include <algorithm>
#include <sstream>

namespace mvcc {

MemoryManager::MemoryManager(long long totalMb) : totalMb_(totalMb) {
    blocks_.push_back(MemoryBlock{0, totalMb, true, -1, ""});
}

long long MemoryManager::allocate(long long sizeMb, long long jobId, const std::string& jobName,
                                  std::string& detail) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (sizeMb <= 0) {
        detail = "invalid allocation size";
        return -1;
    }

    // BEST FIT: smallest free block that is still large enough.
    int bestIndex = -1;
    long long bestSize = 0;
    int candidates = 0;
    for (size_t i = 0; i < blocks_.size(); ++i) {
        const auto& b = blocks_[i];
        if (!b.free || b.sizeMb < sizeMb) continue;
        candidates++;
        if (bestIndex < 0 || b.sizeMb < bestSize) {
            bestIndex = static_cast<int>(i);
            bestSize = b.sizeMb;
        }
    }

    if (bestIndex < 0) {
        failures_++;
        std::ostringstream oss;
        oss << "Best-Fit failed: no free block >= " << sizeMb << " MB";
        lastDecision_ = oss.str();
        detail = lastDecision_;
        return -1;
    }

    MemoryBlock chosen = blocks_[bestIndex];
    long long base = chosen.base;
    long long leftover = chosen.sizeMb - sizeMb;

    blocks_[bestIndex].free = false;
    blocks_[bestIndex].sizeMb = sizeMb;
    blocks_[bestIndex].ownerJobId = jobId;
    blocks_[bestIndex].ownerName = jobName;

    if (leftover > 0) {
        MemoryBlock rest{base + sizeMb, leftover, true, -1, ""};
        blocks_.insert(blocks_.begin() + bestIndex + 1, rest);
    }

    allocations_++;
    std::ostringstream oss;
    oss << "Best-Fit selected block @" << base << " (" << chosen.sizeMb << " MB) out of "
        << candidates << " candidates for " << sizeMb << " MB; " << leftover
        << " MB returned to the free list";
    lastDecision_ = oss.str();
    detail = lastDecision_;
    return base;
}

bool MemoryManager::release(long long jobId) {
    std::lock_guard<std::mutex> lock(mutex_);
    bool found = false;
    for (auto& b : blocks_) {
        if (!b.free && b.ownerJobId == jobId) {
            b.free = true;
            b.ownerJobId = -1;
            b.ownerName.clear();
            found = true;
        }
    }
    if (found) {
        coalesce();
        lastDecision_ = "Released memory of job " + std::to_string(jobId) + " and coalesced holes";
    }
    return found;
}

void MemoryManager::coalesce() {
    for (size_t i = 0; i + 1 < blocks_.size();) {
        if (blocks_[i].free && blocks_[i + 1].free) {
            blocks_[i].sizeMb += blocks_[i + 1].sizeMb;
            blocks_.erase(blocks_.begin() + i + 1);
        } else {
            ++i;
        }
    }
}

MemoryStats MemoryManager::stats() const {
    std::lock_guard<std::mutex> lock(mutex_);
    MemoryStats s;
    s.totalMb = totalMb_;
    for (const auto& b : blocks_) {
        if (b.free) {
            s.freeMb += b.sizeMb;
            s.freeBlocks++;
            s.largestFreeMb = std::max(s.largestFreeMb, b.sizeMb);
        } else {
            s.usedMb += b.sizeMb;
            s.usedBlocks++;
        }
    }
    s.utilization = totalMb_ > 0 ? (100.0 * static_cast<double>(s.usedMb) / totalMb_) : 0.0;
    s.fragmentation =
        s.freeMb > 0 ? (100.0 * (1.0 - static_cast<double>(s.largestFreeMb) / s.freeMb)) : 0.0;
    s.allocationCount = allocations_;
    s.failedAllocations = failures_;
    return s;
}

std::vector<MemoryBlock> MemoryManager::blocks() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return blocks_;
}

std::string MemoryManager::lastDecision() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return lastDecision_;
}

void MemoryManager::reset() {
    std::lock_guard<std::mutex> lock(mutex_);
    blocks_.clear();
    blocks_.push_back(MemoryBlock{0, totalMb_, true, -1, ""});
    allocations_ = 0;
    failures_ = 0;
    lastDecision_.clear();
}

}  // namespace mvcc
