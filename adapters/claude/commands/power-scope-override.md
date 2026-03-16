Request an explicit scope override for the current session.

Collect:
- replacement mission only if it changes
- replacement approved tasks, with a maximum of three
- reason for the override

Then run the local CLI in the repo root with repeated `--task` flags:

```bash
power scope-override --reason "$ARGUMENTS"
```

After the command succeeds, show the rewritten scope and remind the user that the session remains in `Converge`.
