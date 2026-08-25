import type { MarketWeatherDashboardConfig } from "./MarketWeatherDashboard";

const fred = (series: string) => `https://fred.stlouisfed.org/series/${series}`;
const eastmoney = (code: string) => `https://quote.eastmoney.com/${code}.html`;

export const weatherDashboardConfigs = {
  nasdaq: {
    title: "纳斯达克宏观气象站",
    apiPath: "/api/invest-weather/nasdaq",
    sourceLabel: "FRED（St. Louis Fed）",
    sourceFooter: "FRED (Federal Reserve Economic Data)",
    sourceLinks: {
      nasdaq_index: fred("NASDAQCOM"), nasdaq100_index: fred("NASDAQ100"), dgs10: fred("DGS10"),
      fedfunds: fred("FEDFUNDS"), tech_strength: fred("NASDAQCOM"), vxn: fred("VXNCLS"),
      real_rate: fred("DFII10"), hyd: fred("BAMLH0A0HYM2"), dxy: fred("DTWEXBGS"),
      stress: fred("STLFSI4"), curve: fred("T10Y2Y"), margin: fred("BOGZ1FL663067003Q"),
      buffett: fred("GDP"), cpi: fred("CPIAUCSL"), indpro: fred("INDPRO")
    }
  },
  sp500: {
    title: "标普500宏观气象站",
    apiPath: "/api/invest-weather/sp500",
    sourceLabel: "FRED（St. Louis Fed）",
    sourceFooter: "FRED (Federal Reserve Economic Data)",
    sourceLinks: {
      sp500_index: fred("SP500"), unrate: fred("UNRATE"), vix: fred("VIXCLS"), dgs10: fred("DGS10"),
      fedfunds: fred("FEDFUNDS"), hyd: fred("BAMLH0A0HYM2"), dxy: fred("DTWEXBGS"), stress: fred("STLFSI4"),
      curve: fred("T10Y2Y"), margin: fred("BOGZ1FL663067003Q"), buffett: fred("SP500"),
      cpi: fred("CPIAUCSL"), indpro: fred("INDPRO")
    }
  },
  gold: {
    title: "黄金宏观气象站",
    apiPath: "/api/invest-weather/gold",
    sourceLabel: "FRED（St. Louis Fed）",
    sourceFooter: "FRED (Federal Reserve Economic Data)",
    sourceLinks: {
      gold_index: fred("GOLDAMGBD228NLBM"), silver_index: fred("SLVPRUSD"), real_yield: fred("DFII10"),
      breakeven: fred("T10YIE"), fed_assets: fred("WALCL"), nonfarm: fred("PAYEMS"),
      gold_dxy: fred("DTWEXBGS"), gold_unrate: fred("UNRATE")
    }
  },
  hk: {
    title: "港股恒生气象站",
    apiPath: "/api/invest-weather/hk",
    sourceLabel: "FRED + 东方财富公开行情接口",
    sourceFooter: "FRED + 东方财富公开行情接口",
    featuredSectionKeys: ["market", "style"],
    sourceLinks: {
      hsi_index: "https://quote.eastmoney.com/q/100.hsi.html",
      hstech_index: "https://quote.eastmoney.com/q/124.hstech.html",
      hk_dividend_lowvol: "https://quote.eastmoney.com/q/124.hshylv.html",
      hk_style_rotation: "https://quote.eastmoney.com/q/124.hshylv.html",
      hk_dxy: fred("DTWEXBGS"), hk_dgs10: fred("DGS10"), hk_real_yield: fred("DFII10"),
      hk_curve: fred("T10Y2Y"), hk_fci: fred("NFCI"), usd_hkd: fred("DEXHKUS"),
      southbound_flow: "https://data.eastmoney.com/hsgt/hsgtDetail/scgk.html"
    }
  },
  aShare: {
    title: "沪深 A 股气象站",
    apiPath: "/api/invest-weather/a-share",
    sourceLabel: "东方财富公开行情接口",
    sourceFooter: "东方财富公开行情接口",
    loadingText: "正在加载沪深 A 股指标数据...",
    featuredSectionKeys: [],
    sourceLinks: {
      sse: eastmoney("sh000001"), csi300: eastmoney("sh000300"), szse: eastmoney("sz399001"),
      chinext: eastmoney("sz399006"), star50: eastmoney("sh000688"), csi500: eastmoney("sh000905"),
      csi1000: eastmoney("sh000852"), csi_dividend: eastmoney("sh000922")
    }
  }
} satisfies Record<string, MarketWeatherDashboardConfig>;
