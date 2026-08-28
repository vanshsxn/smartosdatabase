#OSDB Core

Intelligent Cloud Task Execution & Resource Management

OSDB Core is a full-stack academic project that combines Operating Systems, DBMS, and Computer Networks into one working platform.

The idea is straightforward: users submit jobs from the web dashboard, and the jobs are sent through an API to a separate C++ task execution engine. The engine handles scheduling, memory allocation, threads, resources, and job states, while PostgreSQL keeps track of the persistent data.

The project brings together concepts that are usually taught separately in college and shows how they can work together in one system.

Note: OSDB Core is not a real hypervisor and it is not intended to replace an actual operating system. The C++ component is an OS-inspired task execution and resource-management engine built for academic purposes.

What does OSDB Core actually do?

The platform currently focuses on three main services:

Compute Service — submit and manage individual jobs.

Batch Job Service — submit and process multiple jobs together.

Resource Monitoring — monitor CPU, memory, threads, jobs and other resource information.

An important part of the project is that the scheduling and resource-management logic is handled by the backend C++ engine rather than being simulated only in the frontend.

The actual scheduling logic lives inside the C++ engine.

For example, when a job is submitted, it can go through the following flow:

User
  ↓
React Dashboard
  ↓
REST API
  ↓
C++ Task Execution Engine
  ↓
Scheduler / Memory Manager / Thread Pool
  ↓
Job Execution
  ↓
PostgreSQL

The frontend is mainly used to control the system and monitor what is happening inside it.

Main Features

Job Management

Users can create jobs with information such as:

Job name

Job type

Priority

CPU requirement

Memory requirement

Estimated execution time

Jobs can move through different states:

QUEUED
READY
RUNNING
PAUSED
COMPLETED
FAILED
CANCELLED

The system also keeps track of submission, start and completion times.

CPU Scheduling

One of the main parts of the project is the scheduler written in C++.

MLFQ Scheduler

The engine uses a Multi-Level Feedback Queue (MLFQ) approach with different priority levels.

Queue 0 → Critical
Queue 1 → High
Queue 2 → Medium
Queue 3 → Low

Jobs can move between queues according to the scheduling policy and time quantum.

Adaptive Scheduler

Apart from MLFQ, the project also includes an adaptive scheduling approach.

Instead of looking at priority alone, the scheduler can consider things such as:

Job priority

Waiting time

CPU availability

Memory availability

Estimated execution time

Tenant credits

A scheduling score is calculated from these factors and used to decide which job should run next.

The dashboard can then show why a particular job was selected.

Memory Management

The C++ engine contains a simulated memory manager based on the Best-Fit allocation algorithm.

It keeps track of memory blocks and supports:

Memory allocation

Memory release

Best-fit block selection

Free blocks

Used blocks

Fragmentation

The dashboard can visualize the current memory state, for example:

[ FREE ][ JOB 101 ][ FREE ][ JOB 105 ][ JOB 106 ][ FREE ]

This also makes it easier to understand how memory allocation changes as jobs start and finish.

Thread Pool

The engine also uses a real C++ thread pool instead of creating a new thread for every task.

The thread pool handles:

Worker threads

Task queues

Job execution

Running jobs

Graceful shutdown

Synchronization is handled using standard C++ primitives such as:

std::mutex

std::condition_variable

std::lock_guard

This part of the project is mainly where the Operating Systems concepts around concurrency and synchronization come together.

Resource Management

Before a job starts, the Resource Manager checks whether enough resources are available.

For example, suppose a job requests:

CPU: 4 cores
Memory: 8 GB

If those resources are available, they are allocated and the job can start.

If they aren't available, the job remains in the queue until resources become available.

After the job finishes, its resources are released.

PostgreSQL Database

PostgreSQL is used as the persistent database for the application.

It stores information such as:

Users

Tenants

Jobs

Job execution logs

Resource usage

Memory allocations

Scheduling history

Credits

Billing records

Audit logs

The database also makes use of normal DBMS concepts such as:

Primary keys

Foreign keys

Constraints

Indexes

Transactions

Views

Triggers

For example, transactions are useful when submitting a job, deducting credits and recording its execution information so that related changes don't end up in an inconsistent state.

Tenant & Credit System

OSDB Core supports multiple tenants.

Each tenant has its own:

Users

Jobs

Credits

Resource usage

Billing history

The system also includes different roles:

ADMIN
TENANT_ADMIN
USER

Tenant isolation is important here because one tenant should not be able to access another tenant's private information.

Jobs can also consume credits based on things such as:

CPU usage

Memory usage

Execution duration

If a tenant doesn't have enough credits, the job should not be executed.

Authentication

The application includes authentication and authorization features.

The planned flow includes:

Registration

Login

Logout

Password hashing

Session/JWT-based authentication

Role-based authorization

Passwords should never be stored as plain text.

Computer Networks Component

The project also demonstrates several Computer Networks concepts through its API architecture.

The application follows a client-server model:

Client
  ↓
HTTP Request
  ↓
REST API
  ↓
Backend
  ↓
C++ Engine / Database
  ↓
HTTP Response
  ↓
Client

The networking side of the project covers concepts such as:

HTTP

REST APIs

JSON

Request/response communication

Authentication

Ports

TCP/IP concepts

Latency

Timeouts

Error handling

API

Some of the main API endpoints include:

POST   /api/jobs
GET    /api/jobs
GET    /api/jobs/:id
DELETE /api/jobs/:id

POST   /api/batch-jobs
GET    /api/batch-jobs

GET    /api/scheduler/status
GET    /api/scheduler/queue

GET    /api/resources
GET    /api/resources/cpu
GET    /api/resources/memory

GET    /api/logs
GET    /api/billing
GET    /api/tenants

POST   /api/auth/login
POST   /api/auth/logout

The important part is that the API doesn't recreate the scheduling algorithms in TypeScript. Scheduling decisions are handled by the C++ engine.

C++ Engine

The C++ engine is kept separate from the frontend and backend.

A simplified structure looks like this:

engine/
├── include/
│   ├── Job.h
│   ├── JobQueue.h
│   ├── Scheduler.h
│   ├── MLFQScheduler.h
│   ├── AdaptiveScheduler.h
│   ├── MemoryManager.h
│   ├── ThreadPool.h
│   ├── ResourceManager.h
│   └── Logger.h
│
├── src/
│   ├── main.cpp
│   ├── Job.cpp
│   ├── JobQueue.cpp
│   ├── Scheduler.cpp
│   ├── MLFQScheduler.cpp
│   ├── AdaptiveScheduler.cpp
│   ├── MemoryManager.cpp
│   ├── ThreadPool.cpp
│   ├── ResourceManager.cpp
│   └── Logger.cpp
│
└── CMakeLists.txt

The engine exposes operations such as:

submitJob()
cancelJob()
getJobStatus()
getSchedulerStatus()
getResourceStatus()
getMemoryStatus()
getQueueStatus()

Project Structure

The overall project follows a monorepo-style structure:

/
├── frontend/
├── backend/
├── engine/
│   ├── include/
│   ├── src/
│   ├── tests/
│   └── CMakeLists.txt
│
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   └── migrations/
│
├── docs/
└── README.md

Keeping these parts separate makes development and testing easier because the UI, API, C++ engine and database can be worked on independently.

Technology Stack

Frontend

React

TypeScript

Vite

Tailwind CSS

shadcn/ui

Lucide Icons

Recharts

Backend

Node.js

TypeScript

REST API

OS / Task Engine

C++

C++17 or newer

CMake

Database

PostgreSQL

Dashboard

The main dashboard is designed around a cloud-console style interface.

It provides sections for:

Dashboard

Compute

Batch Jobs

Scheduler

Resources

Memory

Tenants

Billing

Logs

Settings

The dashboard also provides information such as:

CPU usage

Memory usage

Running jobs

Queued jobs

Remaining credits

Recent jobs

Resource utilization

Job execution information

Charts are used where they make sense, especially for resource monitoring.

Scheduler Visualization

There is also a dedicated scheduler page that makes the execution flow easier to understand:

Incoming Jobs
      ↓
Priority Queues
      ↓
MLFQ / Adaptive Scheduler
      ↓
Resource Manager
      ↓
Thread Pool
      ↓
Execution
      ↓
Completed

The scheduler page can be used to compare MLFQ and Adaptive scheduling and display metrics such as:

Average waiting time

Average turnaround time

CPU utilization

Throughput

Context switches

Demo Mode

The project includes a controlled demo mode for demonstrating how the engine behaves.

Some example jobs include:

CPU-intensive job

Memory-intensive job

High-priority job

Long-running job

Batch of multiple jobs

These jobs are intended to pass through the actual C++ scheduler instead of simply changing status through frontend animations.

Testing

The C++ engine should be tested for the important parts of the system, including:

MLFQ scheduling

Adaptive scheduling

Best-Fit memory allocation

Memory release

Thread pool

Queue operations

Resource allocation

Resource release

Priority handling

Waiting time

Concurrent jobs

The backend/API layer should also have its own tests.

Security

Some of the basic security considerations in the project include:

Password hashing

Authentication

Authorization

Tenant isolation

Input validation

SQL injection protection

API validation

Rate limiting where appropriate

Secure environment variables

Database credentials and other secrets should never be exposed in frontend code.

Error Handling

The application handles common failure cases such as:

Invalid jobs

Insufficient resources

Insufficient credits

Database failures

C++ engine unavailable

Invalid authentication

Unauthorized access

Job execution failures

Memory allocation failures

Errors should be returned to the user in a way that is understandable instead of exposing internal implementation details.

Running the Project

1. Clone the repository

git clone <repository-url>
cd <repository-name>

2. Install frontend/backend dependencies

npm install

3. Start the development server

npm run dev

4. PostgreSQL

Make sure PostgreSQL is installed and running, then configure the database connection using environment variables.

The database schema and seed files are located inside:

database/

5. C++ Engine

The C++ engine is built separately using CMake.

cd engine
mkdir build
cd build
cmake ..
cmake --build .

The exact command may vary slightly depending on the operating system and compiler being used.

Environment Variables

Create an environment file for local development and add the required configuration, for example:

DATABASE_URL=your_postgresql_connection_string
API_PORT=your_api_port

Do not commit actual passwords, API keys or database credentials to GitHub.

Academic Concepts Covered

One of the main goals of OSDB Core is to connect multiple subjects into one project.

Operating Systems

Process/job management

Job queues

CPU scheduling

MLFQ

Adaptive scheduling

Memory management

Best-Fit allocation

Threads

Thread pools

Synchronization

Resource management

Job states

DBMS

Relational database design

Normalization

Primary and foreign keys

Constraints

Indexing

Transactions

Views

Triggers

Audit logs

Billing and resource records

Computer Networks

Client-server architecture

HTTP

REST APIs

JSON

Request/response model

Authentication

TCP/IP concepts

Ports

Latency

Timeouts

API error handling

Why I Built This

Most of the concepts used in Operating Systems are normally demonstrated through small programs, while DBMS and Computer Networks are taught separately.

I wanted to bring these concepts together into something that feels more like a real application.

OSDB Core is my attempt at building a small cloud-style task execution platform where the frontend, backend, database and C++ engine all have a clear role.

It is still an academic project rather than a production cloud platform. The main goal is to keep the core concepts practical instead of hiding the important parts behind frontend simulations.

Project Status

This project is being developed as an academic PBL project and may continue to change as new features and improvements are added.

Some parts of the system may also be simplified compared with what would be required in a production cloud infrastructure platform.

Future Improvements

Some possible improvements for the future include:

Better job prioritization

More scheduling algorithms

Improved resource prediction

Distributed task execution

More detailed monitoring

Container-based isolation

Better authentication and access control

More extensive automated testing

Performance benchmarking

Distributed database support

License

This project is intended primarily for educational and academic use.

If you want to use or modify the project, please check the repository license and follow its terms.
