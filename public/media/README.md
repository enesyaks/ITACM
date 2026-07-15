# Onboarding media

Optional walkthrough video for the first-run product tour.

## Local file

Place either file here (served at the same path):

- `how-it-works.mp4`
- `how-it-works.webm`

Recommended: 16:9, under ~25 MB, silent or with a short voice-over.

If neither file is present, the tour shows the built-in animated product demo.

## Remote URL

Set on the API container / process:

```bash
ONBOARDING_VIDEO_URL=https://www.youtube.com/watch?v=xxxxxxxx
# or a direct MP4 URL
ONBOARDING_VIDEO_URL=https://cdn.example.com/itacm-tour.mp4
```

YouTube links are embedded with youtube-nocookie; other URLs play in a `<video>` element.
