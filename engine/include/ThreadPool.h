#pragma once
// ThreadPool.h — fixed size worker pool.
//
// SYNCHRONISATION NOTES
//  * mutex_            protects the task queue and the shutdown flag.
//  * condition_        wakes a single idle worker when a task is enqueued and
//                      wakes everybody on shutdown.
//  * active_           atomic counter of tasks currently executing, read by
//                      the monitoring endpoint without taking the lock.
//  * shutdown()        is graceful: no new tasks are accepted, queued tasks
//                      are drained, then every worker is joined.

#include <atomic>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>

namespace mvcc {

class ThreadPool {
public:
    explicit ThreadPool(size_t workers);
    ~ThreadPool();

    bool submit(std::function<void()> task);
    void shutdown();

    size_t workerCount() const { return workers_.size(); }
    size_t activeTasks() const { return active_.load(); }
    size_t queuedTasks() const;
    size_t completedTasks() const { return completed_.load(); }
    bool running() const { return !stopping_.load(); }

private:
    void workerLoop();

    mutable std::mutex mutex_;
    std::condition_variable condition_;
    std::queue<std::function<void()>> tasks_;
    std::vector<std::thread> workers_;
    std::atomic<bool> stopping_{false};
    std::atomic<size_t> active_{0};
    std::atomic<size_t> completed_{0};
};

}  // namespace mvcc
