# Call Queue Manager

A small app that gives a caller one phone contact at a time and records the outcome of each call. No real calls are made. Backend: TypeScript, Node.js and Express with in-memory storage. Front end: one plain HTML page and styled with CSS and powered by JavaScript.

Design decisions, API, data model and a worked example are in [DESIGN.md](DESIGN.md).

## How to run

Requires Node.js 20 or newer.

    npm install
    npm start

Then open http://localhost:3000, type a list name, upload `sample.csv`, press **Next contact** and click an outcome button.

To use another port, set the PORT variable, for example `PORT=4000 npm start`.

## How to test

    npm test

This runs 12 automated tests covering the rules, CSV handling, stats and the REST API flow. To check the TypeScript, run `npm run typecheck`.

## Project layout

    src/service.ts      business rules and in-memory store (the most important file)
    src/app.ts          Express routes (thin layer over the service)
    src/csv.ts          small CSV parser
    src/phone.ts        phone cleaning, used to find duplicates
    src/server.ts       starts the server
    public/index.html   the single page
    tests/queue.test.ts automated tests
    sample.csv          the sample from the brief

## Assumptions

- Data is stored in memory, so restarting the server clears everything.
- A contact who did not answer goes to the back of the queue, with no wait timer.
- Rows with a missing phone, or a phone that duplicates an earlier row, are skipped.
- A 10-digit phone number is treated as a US/Canada number.

## What I would do next

- Save data in SQLite so a restart keeps everything.
- Add a wait time before a retry, if "later" should mean a time.
- Add an undo for a wrongly clicked outcome.

## How I used AI

I used Claude to help plan the design, write the code and tests, and build the page. I ran the tests and tried the sample CSV in the browser, and I can explain the retry rule, the duplicate handling, and how `statusOf` and the queue work together.

**Where AI helped**
- Planning the design: it helped me find the gaps in the requirements, like what "later" means for No answer, and how to handle the duplicate and missing phone rows in the sample CSV.
- Writing the code: it gave me the code for the CSV parser, the phone cleaning, the queue rules, the API routes, the page and the tests. I typed and pasted it into my own project one file at a time.
- Explaining: it walked me through what each function does, in simple words.

**What I did myself**
- Set up the project, created every file and ran everything on my own computer.
- Fixed errors as they came up: a TypeScript error about missing Node types (I fixed `tsconfig.json`) and a crash in the tests because I had pasted the server code into the wrong file (I moved it to `server.ts`).
- Ran the 12 automated tests until they all passed, and clicked through the page with `sample.csv` to check each rule by hand.
- Read the code until I could explain it. In particular: `statusOf` works out a contact's status from its attempts, `next()` takes the front of the queue, and `recordAttempt()` puts a No answer contact at the back of the queue.

**What I checked or would change**
- I traced the 3-contact example in DESIGN.md by hand and checked that the app does the same.
- Data is only in memory, so a restart clears it. The next step would be SQLite.