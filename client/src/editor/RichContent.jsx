/**
 * PLACEHOLDER — owned by the editor task.
 *
 * Every article body in the app renders through this component, so the editor
 * agent can swap in the interactive read-only TipTap renderer here and every
 * page picks it up. Keep the `html` prop and the `.prose` wrapper.
 */
export default function RichContent({ html }) {
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html || '' }} />;
}
