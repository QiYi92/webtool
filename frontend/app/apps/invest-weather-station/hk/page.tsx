import { MarketWeatherDashboard } from "@/components/invest-weather/MarketWeatherDashboard";
import { weatherDashboardConfigs } from "@/components/invest-weather/configs";

export default function HongKongWeatherStationPage() {
  return <MarketWeatherDashboard config={weatherDashboardConfigs.hk} />;
}
