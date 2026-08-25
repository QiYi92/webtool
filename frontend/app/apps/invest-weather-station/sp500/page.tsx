import { MarketWeatherDashboard } from "@/components/invest-weather/MarketWeatherDashboard";
import { weatherDashboardConfigs } from "@/components/invest-weather/configs";

export default function Sp500WeatherStationPage() {
  return <MarketWeatherDashboard config={weatherDashboardConfigs.sp500} />;
}
