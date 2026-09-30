# src/features

Code is organised by feature, not by type. One folder per TSD component, created by the task that needs it:

| Folder          | TSD                                                                    |
| --------------- | ---------------------------------------------------------------------- |
| `availability/` | C3 availability engine (pure functions, the only place the rules live) |
| `invites/`      | C2 invite links, cookies, capabilities, action tokens                  |
| `requests/`     | Request intake and the booking lifecycle                               |
| `admin/`        | C4 Jon's admin                                                         |
| `email/`        | C5 outbound templates and inbound routing                              |
| `calendar/`     | C6 Google Calendar gateway (real + mock)                               |
| `photos/`       | C7 photos and stories                                                  |
| `jobs/`         | C8 tick and media job registry                                         |
