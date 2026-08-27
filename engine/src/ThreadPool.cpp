#include "ThreadPool.h"

namespace mvcc {

ThreadPool::ThreadPool(size_t workers) {
    if (workers == 0) workers = 1;
    workers_.reserve(workers);
    for (size_t i = 0; i < workers; ++i) {
        workers_.emplace_back([this] { workerLoop(); });
    }
}

ThreadPool::~ThreadPool() { shutdown(); }

bool ThreadPool::submit(std::function<void()> task) {
    {
        std::lock_guard<std::mutex> lock(mutex_);  // protects tasks_ + stopping_
        if (stopping_.load()) return false;
        tasks_.push(std::move(task));
    }
    condition_.notify_one();  // wake exactly one idle worker
    return true;
}

void ThreadPool::workerLoop() {
    for (;;) {
        std::function<void()> task;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            condition_.wait(lock, [this] { return stopping_.load() || !tasks_.empty(); });
            if (stopping_.load() && tasks_.empty()) return;  // graceful exit
            task = std::move(tasks_.front());
            tasks_.pop();
        }
        active_.fetch_add(1);
        try {
            task();
        } catch (...) {
            // a failing job must never kill a worker thread
        }
        active_.fetch_sub(1);
        completed_.fetch_add(1);
    }
}

void ThreadPool::shutdown() {
    if (stopping_.exchange(true)) return;
    condition_.notify_all();
    for (auto& t : workers_) {
        if (t.joinable()) t.join();
    }
    workers_.clear();
}

size_t ThreadPool::queuedTasks() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return tasks_.size();
}

}  // namespace mvcc
