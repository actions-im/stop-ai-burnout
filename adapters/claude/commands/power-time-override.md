Request the one allowed post-expiry extension for the current session.

Run:

```bash
power time-override --reason "$ARGUMENTS"
```

If it succeeds, state that the session has a single 15-minute extension and remains in `Converge`. If it fails, do not suggest more work.
