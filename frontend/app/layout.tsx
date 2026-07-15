import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export function generateMetadata(): Metadata {
  const requestHeaders = headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;

  return {
    title: {
      default: "Hydra Creator — Creative Video OS",
      template: "%s · Hydra Creator",
    },
    description: "Transforme vídeos longos em clipes verticais prontos para publicar com análise inteligente e controle criativo.",
    openGraph: {
      type: "website",
      locale: "pt_BR",
      title: "Hydra Creator — Creative Video OS",
      description: "Conteúdo longo entra. Clipes memoráveis saem.",
      images: [{ url: socialImage, width: 1744, height: 909, alt: "Hydra Creator OS — Conteúdo longo entra. Clipes memoráveis saem." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Hydra Creator — Creative Video OS",
      description: "Conteúdo longo entra. Clipes memoráveis saem.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
