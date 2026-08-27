#pragma once
// JobQueue.h — thread-safe FIFO ready queue.
//
// SYNCHRONISATION: the queue is touched by the scheduler thread (pop) and by
// the HTTP threads that submit jobs (push), therefore every access is guarded
// by a std::mutex. A std::condition_variable lets the scheduler block instead
// of busy-waiting when the queue is empty.

#include <condition_variable>
#include <deque>
#include <mutex>
#include <vector>

namespace mvcc {

class JobQueue {
public:
    void push(long long jobId);
    void pushFront(long long jobId);
    bool pop(long long& out);                 // non blocking
    bool waitAndPop(long long& out, int timeoutMs);
    bool remove(long long jobId);
    bool empty() const;
    size_t size() const;
    std::vector<long long> snapshot() const;
    void clear();

private:
    mutable std::mutex mutex_;
    std::condition_variable cv_;
    std::deque<long long> queue_;
};

}  // namespace mvcc
