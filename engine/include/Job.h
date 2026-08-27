#pragma once
// Job.h — core job/process model of the MV CloudCore OS engine.
// A Job is the engine's analogue of a PCB (Process Control Block): it stores
// identity, resource requirements, scheduling bookkeeping and the current
// state of the job inside the engine.

#include <atomic>
#include <chrono>
#include <string>

namespace mvcc {

using Clock = std::chrono::steady_clock;
using WallClock = std::chrono::system_clock;

enum class JobStatus { QUEUED, READY, RUNNING, PAUSED, COMPLETED, FAILED, CANCELLED };
enum class Priority { LOW = 3, MEDIUM = 2, HIGH = 1, CRITICAL = 0 };

std::string toString(JobStatus s);
std::string toString(Priority p);
JobStatus jobStatusFromString(const std::string& s);
Priority priorityFromString(const std::string& s);

// Numeric weight used by the adaptive scheduler (CRITICAL is heaviest).
int priorityWeight(Priority p);

struct Job {
    long long id = 0;                 // engine-local job id
    std::string externalId;           // uuid coming from PostgreSQL
    std::string tenantId;
    std::string userId;
    std::string name;
    std::string type = "COMPUTE";     // COMPUTE | BATCH | IO | MEMORY
    Priority priority = Priority::MEDIUM;

    int requestedCores = 1;
    long long requestedMemoryMb = 256;
    long long estimatedMs = 1000;     // estimated burst time

    // Scheduling bookkeeping (all times are engine-monotonic milliseconds).
    long long submittedAtMs = 0;
    long long firstRunAtMs = -1;
    long long startedAtMs = -1;
    long long completedAtMs = -1;
    long long cpuTimeUsedMs = 0;      // accumulated service time
    long long remainingMs = 0;        // remaining burst time
    long long waitingMs = 0;          // accumulated ready-queue waiting time
    long long lastEnqueuedAtMs = 0;

    int queueLevel = 0;               // MLFQ level 0..3
    int contextSwitches = 0;
    int preemptions = 0;
    double lastScore = 0.0;
    std::string lastDecision;         // human readable scheduling explanation

    long long memoryBase = -1;        // base address handed out by MemoryManager
    JobStatus status = JobStatus::QUEUED;
    std::string errorMessage;
    double creditsCharged = 0.0;

    // Cost model shared with the billing tables in PostgreSQL:
    //   credits = cores * 0.5 * seconds + memoryGb * 0.25 * seconds
    double estimatedCredits() const;
    double chargedCredits(long long durationMs) const;
};

long long nowMs();

}  // namespace mvcc
