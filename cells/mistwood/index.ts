/**
 * `@c15r/mistwood` — moved: Mistwood is an experiment in the lab now (`@c15r/lab`, cells/lab/).
 * Every address here goes on to it, the query kept, so a journey left in a link (`?seed=…&x=…`)
 * opens where it was.
 */
const LAB = 'https://c15r-lab.on.parc.land/mistwood';

export const handler = async (event: { rawQueryString?: string }) => ({
  statusCode: 301,
  headers: { location: `${LAB}${event.rawQueryString ? `?${event.rawQueryString}` : ''}`, 'cache-control': 'public, max-age=3600' },
  body: '',
});
