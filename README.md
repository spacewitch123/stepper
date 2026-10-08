# Stepper

Step through every change Claude made, one at a time, like pages with pagination dots.

```
Request 2 of 3 · Add a yearly plan to the pricing page          Change 2 of 4
●  ●  ○  ○

✎ Edited  Pricing.tsx  src/components  · line 41  · +12 −3

[ ‹ Prev ]  [ Next › ]  [ Explain ]

Adds a yearly price option so visitors can save by paying once a year.

  41   <Price />
  42 - monthly
  42 + yearly
  43 + <Yearly />
```

- **Dots:** one for each change in a request. The filled one is where you are, and new files show in green. Long lists show `+N` for the dots that don't fit.
- **The line above the diff:** a new file or an edit, the file's name and folder, where the change starts, and how many lines were added and removed.
- **Explain:** puts the change into one or two plain-English sentences. It only runs when you press it, so it costs nothing unless you use it.
- **Moving around:** `n` goes to the next change and `p` to the previous one, and they carry on into your earlier requests. `e` explains.

After Claude changes files, a line above the prompt shows how many changes your last request made, with a **Step through** button.

It works well with [Clean View](https://github.com/spacewitch123/clean-view), which hides the technical rows while Claude works. Stepper is how you review what changed once the work is done.

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install stepper --marketplace spacewitch123/stepper
```

## Commands

- `/changes` opens the stepper at your last request.
- `/changes clear` empties the list.

## For developers

```
claude plugin validate .
claude plugin test .
```

Changes are read from the Edit and Write tools' own results, so no extra file reads happen. Plugin state under `stepper` (`changes`, `selectedId`, `isOpen`, `explanations`, `explainingId`) is typed in `types/index.d.ts`.
