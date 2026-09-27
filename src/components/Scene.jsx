/* =============================================================
   CLIRevenue — one scene
   -------------------------------------------------------------
   A `<section>` only becomes a landmark if it has an accessible
   name, so every scene is labelled by the heading that names it.
   That does two things at once: it gives a screen-reader user one
   navigable region per scene instead of one undifferentiated wall of
   text, and it makes the region's name come from the sentence the
   scene is actually making rather than from the decorative chapter
   number above it.

   Three shapes cover the scenes:

   - `label` + `title` — the ordinary case. The eyebrow and the
     heading render here, and the section points at the heading.
   - `labelledBy` — for a scene that brings its own heading, which is
     the CTA: the closing type is the scene, so there is no head to
     hang the eyebrow and title on.
   - `ariaLabel` — for a scene with no heading at all, which is the
     opening: a terminal and nothing else.

   The scene titles sit at `h2` directly under the document `h1`, with
   nothing nested beneath them, so the outline has no gaps in it.
   ============================================================= */

function Scene({ id, label, title, body, labelledBy, ariaLabel, children }) {
  const titleId = label && title ? `${id}-title` : undefined

  return (
    <section
      className="scene"
      id={id}
      data-scene={id}
      aria-labelledby={labelledBy ?? titleId}
      aria-label={labelledBy || titleId ? undefined : ariaLabel}
    >
      <div className="scene__inner">
        {label && (
          <div className="scene__head">
            <span className="eyebrow">{label}</span>
            {title && (
              <h2 className="scene__title" id={titleId}>
                {title}
              </h2>
            )}
            {body && <p className="scene__body">{body}</p>}
          </div>
        )}
        {children}
      </div>
    </section>
  )
}

export default Scene
