Compact multiple related parked ideas into one canonical parked entry.

First run:

```bash
power parking-search --query "$ARGUMENTS" --json
```

Then:
- show the matching entry ids, ideas, and reasons
- propose one canonical parked idea and one summary reason
- ask for confirmation before compacting

After confirmation, run the local CLI with repeated `--entry` flags:

```bash
power parking-compact --entry "<entry id 1>" --entry "<entry id 2>" --idea "<canonical idea>" --reason "<summary reason>"
```

After the command succeeds, show the new canonical parked entry id, idea, and the source entry ids that were compacted.
