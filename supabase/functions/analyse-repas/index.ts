// Analyse d'une photo de repas avec Claude — réservée au compte autorisé.
// Secrets attendus côté Supabase : ANTHROPIC_API_KEY (ajouté par le propriétaire).
// SUPABASE_URL et SUPABASE_ANON_KEY sont fournis automatiquement.

const AUTORISES = ["96696a4e-1802-4183-a776-cf525d1455f4"]; // Geogeo
const ORIGINE = "https://17lucratif.github.io";
const MODELE = "claude-sonnet-5-5";

const cors = {
  "Access-Control-Allow-Origin": ORIGINE,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  // 1. Qui appelle ? (jeton de session Supabase)
  const auth = req.headers.get("Authorization") ?? "";
  const u = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  });
  if (!u.ok) return json({ error: "not_auth" }, 401);
  const user = await u.json();
  if (!AUTORISES.includes(user.id)) return json({ error: "forbidden" }, 403);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "no_key" }, 503);

  // 2. Photo
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const image = String(body.image ?? "");
  const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(String(body.mediaType)) ? String(body.mediaType) : "image/jpeg";
  if (!image || image.length > 3_000_000) return json({ error: "bad_image" }, 400);
  const moment = String(body.moment ?? "repas").slice(0, 20);
  const cible = Number(body.cible) || null;
  const deja = Number(body.deja) || 0;

  const consigne =
    `Tu es un diététicien bienveillant et concret. Photo d'un ${moment}. ` +
    (cible ? `Objectif du jour : ${cible} kcal, déjà consommé : ${deja} kcal. ` : "") +
    `Identifie les aliments visibles, estime les portions et les calories de façon réaliste (sans exagérer ni minimiser). ` +
    `Réponds en français, uniquement en JSON valide, sans texte autour, de cette forme : ` +
    `{"nom":"nom court du repas","plats":[{"nom":"...","portion":"ex. 150 g","kcal":0}],"kcal":0,"kcal_min":0,"kcal_max":0,` +
    `"proteines":0,"glucides":0,"lipides":0,"confiance":"faible|moyenne|bonne","conseil":"une phrase pratique, sans culpabiliser"}. ` +
    `Si la photo ne montre pas de nourriture, réponds {"erreur":"pas de repas visible"}.`;

  // 3. Appel à Claude
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELE,
      max_tokens: 900,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
        { type: "text", text: consigne },
      ] }],
    }),
  });
  if (!r.ok) return json({ error: "api", status: r.status, detail: (await r.text()).slice(0, 300) }, 502);
  const d = await r.json();
  const txt = (d.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return json({ error: "parse" }, 502);
  try { return json(JSON.parse(m[0])); } catch { return json({ error: "parse" }, 502); }
});
