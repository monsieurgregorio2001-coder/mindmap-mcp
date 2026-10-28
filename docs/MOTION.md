# Living Mindmap room motion

Lines for the hub's `house/MOTION.md`. All values are house tokens. Calm is `data-motion="calm"` or OS reduced motion with no stored choice.

| Animation | Purpose | Tokens | Calm |
| --- | --- | --- | --- |
| Agent node landing (graph and outline) | The one bouncy moment: an agent node arrives beside its parent. | `--h-dur-page`, `--h-spring-bouncy`, 14 px drop, scale 0.92 | 160 ms opacity fade, no movement. |
| Agent edge | Connection fades in. | `--h-dur-ui`, `--h-ease-out` | 160 ms. |
| Refused node drift | The near-duplicate moves toward its twin and shows its score. | `--h-dur-page`, `--h-spring-smooth` | No drift. The node and the score label fade in. |
| Replay sheet | Bottom sheet on narrow screens. | `--h-dur-page`, `--h-spring-smooth` | 160 ms fade. |
