# UI copy

- Avoid unnecessary secondary labels and descriptions (subtitles, helper text, captions restating what the screen already shows). Let the layout do the explaining.

# UI layout

- Keep containers whose content changes at a stable size: dialogs, panels, lists, tabs and anything filled asynchronously must not grow or shrink with their content or between states (loading, empty, filled, error). Give them a fixed height (or reserve the space) and scroll inside; long single-line content (paths, breadcrumbs) stays on one line instead of wrapping.
- Page content flows with the page scroll: no cards or panels with their own inner scroll inside a page (inner scrolling is for dialogs and pickers only). Collections of records (accounts, sources, libraries…) are tables; clicking a row opens the record's details and settings in a dialog (or a dedicated page with a back arrow when it is too large for one), never in a side panel that stacks under the list on narrow screens.
