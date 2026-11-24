# Probe board

A telnet service any terminal can connect to. It records what the terminal says about itself and how it answers the detection probes BBS hosts use, and writes one JSON report per connection. Reports feed the terminal support matrix and become test fixtures (`test/fixtures/probe_board/`).

```
npm run probe                                   # listen on 0.0.0.0:4041, reports in ./probe-reports
node tools/probe_board --port 4041 --safe       # skip probes some terminals print
node tools/probe_board --label "SyncTERM 1.333" --once
node tools/probe_board --selftest               # every scripted fake terminal against the board
```

Connect a terminal to the host on port 4041 with telnet. A run takes a few seconds. The board then shows what it concluded and asks for a name for the report; `--label` or `--no-prompt` skips the question.

## What it records

- **Telnet:** every TTYPE the terminal cycles through, NAWS byte for byte, NEW-ENVIRON variables, and the option negotiation.
- **Probes** (`probes.js`): DA (primary, secondary, tertiary, CTerm `CSI < c`), DSR, three ways of asking for the size (`999;999` + CPR, `CSI 255 n`, `CSI 18 t`), extended CPR, the CTerm `CSI = Ps n` reports, font select, then the risky ones: XTVERSION, OSC 10, an empty APC, and ENQ.

Each probe is written on a cleared line of the probe area. Two cursor reports follow it:
- one shows where the probe left the cursor, so a probe printed as text is caught;
- the other is a sentinel at row 2, column 7.

A step ends when the sentinel's reply arrives, so every byte before it belongs to that probe. That holds when a terminal answers extra queries with cursor reports, and when it sends replies one byte per packet.

## What it concludes (`analyze.js`)

`analyze(report)` is pure, so old reports can be re-read when the rules change. It works out:
- cursor report quirks: column;row order (Terminate) and row offsets (Telix);
- sizes, with flags for a 999 that wrapped to 231 (Procomm), a column-79 clamp (Telemate), a move that was ignored (Qmodem), malformed NAWS (NetRunner), and NAWS with the high byte of each dimension dropped (Windows telnet.exe: 270 columns sent as 14);
- a DSR (`CSI 5 n`) answered with anything but `CSI 0 n`, and NAWS sent without `WILL NAWS`;
- identity from DA, the CTerm capability list, XTVERSION and the answerback;
- which probes were printed.

`tools/` is not part of the published package.
