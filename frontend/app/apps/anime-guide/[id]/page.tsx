import { AnimeDetailPage } from "@/components/anime-guide/AnimeDetailPage";

type AnimeDetailRouteProps = {
  params: { id: string };
};

export default function AnimeGuideDetailPage({ params }: AnimeDetailRouteProps) {
  return <AnimeDetailPage id={params.id} />;
}
