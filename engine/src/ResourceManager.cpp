#include "ResourceManager.h"

#include <sstream>

namespace mvcc {

ResourceManager::ResourceManager(int cores, MemoryManager* memory)
    : totalCores_(cores), memory_(memory) {}

bool ResourceManager::canAdmit(int cores, long long memoryMb, std::string& why) const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (cores > totalCores_) {
        why = "requested " + std::to_string(cores) + " cores but the node only has " +
              std::to_string(totalCores_);
        return false;
    }
    if (totalCores_ - usedCores_ < cores) {
        why = "only " + std::to_string(totalCores_ - usedCores_) + " of " +
              std::to_string(totalCores_) + " cores free";
        return false;
    }
    MemoryStats st = memory_->stats();
    if (st.largestFreeMb < memoryMb) {
        why = "largest free memory hole is " + std::to_string(st.largestFreeMb) + " MB < " +
              std::to_string(memoryMb) + " MB";
        return false;
    }
    why = "sufficient CPU and memory available";
    return true;
}

bool ResourceManager::acquire(long long jobId, const std::string& jobName, int cores,
                              long long memoryMb, std::string& detail) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (cores > totalCores_ - usedCores_) {
        detail = "CPU unavailable: " + std::to_string(totalCores_ - usedCores_) + " free cores";
        return false;
    }
    std::string memDetail;
    long long base = memory_->allocate(memoryMb, jobId, jobName, memDetail);
    if (base < 0) {
        detail = memDetail;
        return false;
    }
    usedCores_ += cores;
    reservations_[jobId] = Reservation{cores, memoryMb};
    std::ostringstream oss;
    oss << "Allocated " << cores << " core(s) and " << memoryMb << " MB. " << memDetail;
    detail = oss.str();
    return true;
}

void ResourceManager::release(long long jobId) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = reservations_.find(jobId);
    if (it == reservations_.end()) return;
    usedCores_ -= it->second.cores;
    if (usedCores_ < 0) usedCores_ = 0;
    reservations_.erase(it);
    memory_->release(jobId);
}

ResourceSnapshot ResourceManager::snapshot() const {
    std::lock_guard<std::mutex> lock(mutex_);
    ResourceSnapshot s;
    s.totalCores = totalCores_;
    s.usedCores = usedCores_;
    s.freeCores = totalCores_ - usedCores_;
    s.cpuUtilization = totalCores_ > 0 ? 100.0 * usedCores_ / totalCores_ : 0.0;
    MemoryStats m = memory_->stats();
    s.totalMemoryMb = m.totalMb;
    s.usedMemoryMb = m.usedMb;
    s.freeMemoryMb = m.freeMb;
    s.memoryUtilization = m.utilization;
    s.activeAllocations = static_cast<int>(reservations_.size());
    return s;
}

}  // namespace mvcc
