RIGOR ROUTER — RENDER/RUN GROUNDING matched for this task. (If this prompt isn't asking for code work, ignore this note.)

This task produces something runnable or viewable (UI, page, chart, script, component). The claim layer for this work is **observed behavior**, not written code:

1. **Run or render it before "done".** Execute the script, load the page, render the chart, click the button — with your own tool calls. "The code looks right" is not an observation.
2. **Observe the actual output.** Read the console, snapshot the page, check the rendered artifact. Verify the specific thing you changed, not just that nothing crashed.
3. **Exercise the change end-to-end.** If you changed an interaction, perform the interaction. If you changed a layout, look at the layout (including dark mode / narrow widths when relevant).
4. **Claim only what you watched happen.** The receipt names the observation ("clicked submit, form posted, row appeared"), not the intention.

A companion Stop hook mechanically checks that runnable edits were followed by at least one real execution this session — don't make it fire.
