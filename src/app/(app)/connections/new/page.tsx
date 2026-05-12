import { redirect } from "next/navigation";

/**
 * Legacy route — superseded by /credentials/new. Kept as a redirect so old
 * bookmarks and any in-app links that haven't been updated yet still work.
 */
export default function LegacyNewConnectionPage() {
  redirect("/credentials/new");
}
