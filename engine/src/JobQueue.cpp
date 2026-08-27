#include "JobQueue.h"

#include <algorithm>
#include <chrono>

namespace mvcc {

void JobQueue::push(long long jobId) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        queue_.push_back(jobId);
    }
    cv_.notify_one();
}

void JobQueue::pushFront(long long jobId) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        queue_.push_front(jobId);
    }
    cv_.notify_one();
}

bool JobQueue::pop(long long& out) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (queue_.empty()) return false;
    out = queue_.front();
    queue_.pop_front();
    return true;
}

bool JobQueue::waitAndPop(long long& out, int timeoutMs) {
    std::unique_lock<std::mutex> lock(mutex_);
    if (!cv_.wait_for(lock, std::chrono::milliseconds(timeoutMs),
                      [this] { return !queue_.empty(); })) {
        return false;
    }
    out = queue_.front();
    queue_.pop_front();
    return true;
}

bool JobQueue::remove(long long jobId) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = std::find(queue_.begin(), queue_.end(), jobId);
    if (it == queue_.end()) return false;
    queue_.erase(it);
    return true;
}

bool JobQueue::empty() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return queue_.empty();
}

size_t JobQueue::size() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return queue_.size();
}

std::vector<long long> JobQueue::snapshot() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return std::vector<long long>(queue_.begin(), queue_.end());
}

void JobQueue::clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    queue_.clear();
}

}  // namespace mvcc
