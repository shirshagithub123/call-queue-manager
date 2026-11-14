# Call Queue Manager: Design

## 1. Functional requirements

Requirements 1 to 10 from the brief apply as written. The gaps I found, with my decisions, are below.

### Gaps and decisions

| # | Gap | Decision | Why |
|---|-----|----------|-----|
| 1 | Req 8: what does "later" mean for No answer? | Contact goes to the back of the queue. No timer. | Simplest option; everyone else gets a turn first and no clock is needed. |
| 2 | When does an attempt count toward the max? | When the outcome is saved. | A contact handed out but never called should not lose a try. |
| 3 | What if Next is pressed twice before an outcome is recorded? | Backend returns the same current contact. | Nobody is skipped and no attempt is wasted. |
| 4 | Sample CSV: Maria Lopez has the same phone as James Carter, and phones are written in different formats, like "(312) 555-0103". | Compare digits only (a 10-digit number is treated as a US number). Same number again is skipped as "duplicate phone"; first row wins. | Calling one number twice wastes calls and uses up attempts. |
| 5 | Sample CSV: Aisha Bello has no phone. | Skip as "missing phone" (req 2). | She cannot be called. |

### My version of the requirements

1. Upload a list name, max attempts and CSV with columns name and phone.
2. Rows with a missing, invalid or duplicate phone are skipped. The response says how many were added and skipped, and why.
3. "Next" returns one contact, or a message when nobody is left.
4. The caller records one outcome: Connected, No answer or Wrong number.
5. Every attempt is saved with its time and outcome.
6. A contact is never called more than the max attempts.
7. Connected or Wrong number means finished, never given out again.
8. No answer with attempts left goes to the back of the queue.
9. Each list shows pending, finished and out-of-attempts counts. The contact currently on a call counts as pending.
10. One page: pick a list, see the current contact, click an outcome, get the next contact, see the stats.

### Non-functional requirements

- One caller only: no login and no several callers at once.
- The rules (6, 7 and 8) live in the backend. The page only shows data and sends clicks.
- Max attempts must be a whole number from 1 to 20.
- Data is stored in memory, so everything is lost if the server restarts. Accepted for this exercise; SQLite would be the next step.
- Errors: 400 for bad input, 404 for an unknown list, 409 for an outcome sent twice or for a contact that is not the current one.

## 2. API

Base path: /api. All bodies are JSON.

| Method | Path | Request | Response |
|--------|------|---------|----------|
| POST | /lists | { name, maxAttempts, csv } | 201 { list, added, skipped, skippedRows } |
| GET | /lists | none | 200 list of lists with stats |
| GET | /lists/:id | none | 200 one list with stats |
| GET | /lists/:id/stats | none | 200 { total, pending, finished, outOfAttempts } |
| POST | /lists/:id/next | none | 200 { contact, stats }, or { contact: null, message } when nobody is left |
| POST | /lists/:id/attempts | { contactId, outcome } | 201 { attempt, status, stats } |
| GET | /lists/:id/attempts | none | 200 list of all attempts, oldest first |

## 3. Data model

In-memory objects:

- **ContactList**: id, name, maxAttempts, createdAt, contacts, queue, currentContactId
- **Contact**: id, name, phone, phoneKey (digits only, used to find duplicates), attempts
- **Attempt**: id, contactId, outcome, at (time)

A contact's status is not stored. It is worked out from its attempts by one function:

- last outcome is Connected or Wrong number: finished
- number of attempts has reached the max: out of attempts
- otherwise: pending

The queue is a list of contact ids. The first one is the next to be called.

## 4. Deep dive: how the next contact is picked

1. If a contact is already being called (no outcome yet), return the same one.
2. Otherwise take the contact at the front of the queue.
3. Check it again with the status rule. If it is not pending, skip it.
4. If the queue is empty, return "nobody left".
5. When an outcome is saved: store the attempt. If the contact is still pending (No answer with tries left), put it at the back of the queue.

### Example: Ann, Ben and Cara, max attempts = 2

| Step | Action | Queue after | What happens |
|------|--------|-------------|--------------|
| 1 | Next | Ben, Cara | Ann is being called |
| 2 | Next again | Ben, Cara | Ann again, nothing changes |
| 3 | Ann: No answer | Ben, Cara, Ann | Ann has 1 attempt, goes to the back |
| 4 | Next, Ben: Connected | Cara, Ann | Ben is finished for good |
| 5 | Next, Cara: No answer | Ann, Cara | Cara has 1 attempt |
| 6 | Next, Ann: No answer | Cara | Ann has 2 = max, out of attempts, not re-queued |
| 7 | Next, Cara: No answer | empty | Cara has 2 = max, out of attempts |
| 8 | Next | empty | "Nobody left to call" |

Final stats: total 3, pending 0, finished 1 (Ben), out of attempts 2 (Ann and Cara).

## 5. What I would do next

- Save data in SQLite so a restart keeps everything.
- Add a wait time before retrying, if "later" should mean a time.
- Use a real file upload instead of sending the CSV as text.
- Add an undo button for a wrongly clicked outcome.