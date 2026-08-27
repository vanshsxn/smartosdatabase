// main.cpp — MV CloudCore engine daemon.
// Boots the Engine (scheduler + memory manager + resource manager + thread
// pool) and exposes it over the hand written HTTP server so the Node API layer
// can drive it.

#include <cstdlib>
#include <csignal>
#include <string>

#include "Engine.h"
#include "HttpServer.h"
#include "Json.h"
#include "Logger.h"

using namespace mvcc;

namespace {

Engine* g_engine = nullptr;
HttpServer* g_server = nullptr;

int envInt(const char* key, int def) {
    const char* v = std::getenv(key);
    return v ? std::atoi(v) : def;
}

void writeJob(json::Writer& w, const Job& job) {
    w.beginObject();
    w.kv("id", job.id);
    w.kv("externalId", job.externalId);
    w.kv("tenantId", job.tenantId);
    w.kv("userId", job.userId);
    w.kv("name", job.name);
    w.kv("type", job.type);
    w.kv("priority", toString(job.priority));
    w.kv("status", toString(job.status));
    w.kv("requestedCores", job.requestedCores);
    w.kv("requestedMemoryMb", job.requestedMemoryMb);
    w.kv("estimatedMs", job.estimatedMs);
    w.kv("remainingMs", job.remainingMs);
    w.kv("cpuTimeUsedMs", job.cpuTimeUsedMs);
    w.kv("waitingMs", job.waitingMs);
    w.kv("turnaroundMs", job.completedAtMs > 0 ? job.completedAtMs - job.submittedAtMs : 0LL);
    w.kv("responseMs", job.firstRunAtMs >= 0 ? job.firstRunAtMs - job.submittedAtMs : -1LL);
    w.kv("queueLevel", job.queueLevel);
    w.kv("contextSwitches", job.contextSwitches);
    w.kv("preemptions", job.preemptions);
    w.kv("memoryBase", job.memoryBase);
    w.kv("lastScore", job.lastScore);
    w.kv("lastDecision", job.lastDecision);
    w.kv("estimatedCredits", job.estimatedCredits());
    w.kv("creditsCharged", job.creditsCharged);
    w.kv("submittedAtMs", job.submittedAtMs);
    w.kv("completedAtMs", job.completedAtMs);
    w.kv("errorMessage", job.errorMessage);
    w.endObject();
}

HttpResponse jsonRes(const std::string& body, int status = 200) {
    return HttpResponse{status, "application/json", body};
}

void onSignal(int) {
    if (g_server) g_server->stop();
    if (g_engine) g_engine->stop();
    std::exit(0);
}

}  // namespace

int main() {
    EngineConfig cfg;
    cfg.cores = envInt("ENGINE_CORES", 8);
    cfg.memoryMb = envInt("ENGINE_MEMORY_MB", 16384);
    cfg.workers = static_cast<size_t>(envInt("ENGINE_WORKERS", 4));
    const char* policy = std::getenv("ENGINE_POLICY");
    cfg.policy = policy ? policy : "MLFQ";
    int port = envInt("ENGINE_PORT", 9090);

    Engine engine(cfg);
    HttpServer server(port, envInt("ENGINE_HTTP_THREADS", 8));
    g_engine = &engine;
    g_server = &server;
    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);
    std::signal(SIGPIPE, SIG_IGN);

    engine.start();

    server.route("GET", "/health", [&](const HttpRequest&) {
        json::Writer w;
        w.beginObject().kv("status", "ok").kv("engine", "mv-cloudcore").kv("policy",
                                                                           engine.policy());
        w.kv("workers", static_cast<long long>(engine.pool().workerCount()));
        w.kv("paused", engine.paused());
        w.endObject();
        return jsonRes(w.str());
    });

    server.route("POST", "/api/jobs", [&](const HttpRequest& req) {
        auto body = json::parseFlat(req.body);
        Job job;
        job.externalId = json::toStr(body, "externalId");
        job.tenantId = json::toStr(body, "tenantId");
        job.userId = json::toStr(body, "userId");
        job.name = json::toStr(body, "name", "unnamed-job");
        job.type = json::toStr(body, "type", "COMPUTE");
        job.priority = priorityFromString(json::toStr(body, "priority", "MEDIUM"));
        job.requestedCores = static_cast<int>(json::toInt(body, "requestedCores", 1));
        job.requestedMemoryMb = json::toInt(body, "requestedMemoryMb", 256);
        job.estimatedMs = json::toInt(body, "estimatedMs", 1000);

        SubmitResult r = engine.submit(std::move(job));
        json::Writer w;
        w.beginObject().kv("accepted", r.accepted).kv("jobId", r.jobId).kv("message", r.message);
        w.endObject();
        return jsonRes(w.str(), r.accepted ? 202 : 409);
    });

    server.route("GET", "/api/jobs", [&](const HttpRequest& req) {
        auto tenant = req.query.count("tenantId") ? req.query.at("tenantId") : std::string();
        size_t limit = req.query.count("limit")
                           ? static_cast<size_t>(std::stoul(req.query.at("limit")))
                           : 200;
        json::Writer w;
        w.beginObject().beginArray("jobs");
        for (const Job& job : engine.jobs(tenant, limit)) writeJob(w, job);
        w.endArray().endObject();
        return jsonRes(w.str());
    });

    server.route("GET", "/api/jobs/:id", [&](const HttpRequest& req) {
        Job job;
        if (!engine.getJob(std::stoll(req.query.at("id")), job))
            return jsonRes(R"({"error":"job not found"})", 404);
        json::Writer w;
        writeJob(w, job);
        return jsonRes(w.str());
    });

    server.route("DELETE", "/api/jobs/:id", [&](const HttpRequest& req) {
        std::string message;
        bool ok = engine.cancel(std::stoll(req.query.at("id")), message);
        json::Writer w;
        w.beginObject().kv("cancelled", ok).kv("message", message).endObject();
        return jsonRes(w.str(), ok ? 200 : 409);
    });

    server.route("POST", "/api/engine/pause", [&](const HttpRequest&) {
        engine.setPaused(true);
        return jsonRes(R"({"paused":true})");
    });

    server.route("POST", "/api/engine/resume", [&](const HttpRequest&) {
        engine.setPaused(false);
        return jsonRes(R"({"paused":false})");
    });

    server.route("GET", "/api/tenants", [&](const HttpRequest&) {
        json::Writer w;
        w.beginObject().beginArray("tenants");
        for (const auto& [id, credits] : engine.allTenantCredits()) {
            w.beginObject().kv("tenantId", id).kv("credits", credits).endObject();
        }
        w.endArray().endObject();
        return jsonRes(w.str());
    });

    server.route("GET", "/api/metrics", [&](const HttpRequest&) {
        SchedulerMetrics m = engine.metrics();
        json::Writer w;
        w.beginObject();
        w.kv("policy", engine.policy());
        w.kv("avgWaitingMs", m.avgWaitingMs);
        w.kv("avgTurnaroundMs", m.avgTurnaroundMs);
        w.kv("avgResponseMs", m.avgResponseMs);
        w.kv("cpuUtilization", m.cpuUtilization);
        w.kv("throughputPerMin", m.throughputPerMin);
        w.kv("contextSwitches", m.contextSwitches);
        w.kv("preemptions", m.preemptions);
        w.kv("completed", m.completed);
        w.kv("failed", m.failed);
        w.kv("cancelled", m.cancelled);
        w.kv("running", m.running);
        w.kv("queued", m.queued);
        w.endObject();
        return jsonRes(w.str());
    });

    server.route("GET", "/api/resources", [&](const HttpRequest&) {
        ResourceSnapshot r = engine.resources();
        MemoryStats mem = engine.memory();
        json::Writer w;
        w.beginObject();
        w.kv("totalCores", r.totalCores).kv("usedCores", r.usedCores).kv("freeCores", r.freeCores);
        w.kv("cpuUtilization", r.cpuUtilization);
        w.kv("totalMemoryMb", r.totalMemoryMb).kv("usedMemoryMb", r.usedMemoryMb);
        w.kv("freeMemoryMb", r.freeMemoryMb).kv("memoryUtilization", r.memoryUtilization);
        w.kv("activeAllocations", r.activeAllocations);
        w.kv("fragmentation", mem.fragmentation);
        w.kv("largestFreeMb", mem.largestFreeMb);
        w.kv("threadPoolWorkers", static_cast<long long>(engine.pool().workerCount()));
        w.kv("threadPoolActive", static_cast<long long>(engine.pool().activeTasks()));
        w.kv("threadPoolQueued", static_cast<long long>(engine.pool().queuedTasks()));
        w.kv("threadPoolCompleted", static_cast<long long>(engine.pool().completedTasks()));
        w.endObject();
        return jsonRes(w.str());
    });

    server.route("GET", "/api/memory", [&](const HttpRequest&) {
        MemoryStats s = engine.memory();
        json::Writer w;
        w.beginObject();
        w.kv("totalMb", s.totalMb).kv("usedMb", s.usedMb).kv("freeMb", s.freeMb);
        w.kv("utilization", s.utilization).kv("fragmentation", s.fragmentation);
        w.kv("largestFreeMb", s.largestFreeMb).kv("freeBlocks", s.freeBlocks);
        w.kv("usedBlocks", s.usedBlocks).kv("allocationCount", s.allocationCount);
        w.kv("failedAllocations", s.failedAllocations);
        w.beginArray("blocks");
        for (const MemoryBlock& b : engine.memoryBlocks()) {
            w.beginObject();
            w.kv("base", b.base).kv("sizeMb", b.sizeMb).kv("free", b.free);
            w.kv("ownerJobId", b.ownerJobId).kv("ownerName", b.ownerName);
            w.endObject();
        }
        w.endArray().endObject();
        return jsonRes(w.str());
    });

    server.route("GET", "/api/scheduler/queues", [&](const HttpRequest&) {
        json::Writer w;
        w.beginObject().kv("policy", engine.policy()).beginArray("levels");
        for (const auto& [level, ids] : engine.queues()) {
            w.beginObject();
            w.kv("level", level).kv("quantumMs", engine.quantumFor(level));
            w.beginArray("jobIds");
            for (long long id : ids) w.value(id);
            w.endArray().endObject();
        }
        w.endArray();
        w.beginArray("decisions");
        for (const SchedulingDecision& d : engine.recentDecisions(20)) {
            w.beginObject();
            w.kv("jobId", d.jobId).kv("score", d.score).kv("policy", d.policy);
            w.kv("queueLevel", d.queueLevel).kv("reason", d.reason);
            w.endObject();
        }
        w.endArray().endObject();
        return jsonRes(w.str());
    });

    server.route("POST", "/api/scheduler/policy", [&](const HttpRequest& req) {
        auto body = json::parseFlat(req.body);
        engine.setPolicy(json::toStr(body, "policy", "MLFQ"));
        json::Writer w;
        w.beginObject().kv("policy", engine.policy()).endObject();
        return jsonRes(w.str());
    });

    server.route("POST", "/api/tenants/credits", [&](const HttpRequest& req) {
        auto body = json::parseFlat(req.body);
        std::string tenant = json::toStr(body, "tenantId");
        double credits = static_cast<double>(json::toInt(body, "credits", 0));
        engine.setTenantCredits(tenant, credits);
        json::Writer w;
        w.beginObject().kv("tenantId", tenant).kv("credits", credits).endObject();
        return jsonRes(w.str());
    });

    server.route("GET", "/api/logs", [&](const HttpRequest& req) {
        size_t n = req.query.count("limit")
                       ? static_cast<size_t>(std::stoul(req.query.at("limit")))
                       : 100;
        long long jobId = req.query.count("jobId") ? std::stoll(req.query.at("jobId")) : -1;
        json::Writer w;
        w.beginObject().beginArray("logs");
        for (const LogEntry& e : Logger::instance().tail(n, jobId)) {
            w.beginObject();
            w.kv("timestampMs", e.timestampMs).kv("level", Logger::levelName(e.level));
            w.kv("source", e.source).kv("jobId", e.jobId).kv("message", e.message);
            w.endObject();
        }
        w.endArray().endObject();
        return jsonRes(w.str());
    });

    server.start();
    engine.stop();
    return 0;
}
