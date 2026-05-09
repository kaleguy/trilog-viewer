import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  Wind,
  type LucideIcon,
} from 'lucide-react';

/**
 * Lucide icon for a weather record. Mirrors `getLucideWeatherIcon` in the
 * iPhone app's WeatherStrip — keep in sync when the iOS mapping changes.
 */
export function pickWeatherIcon(shortForecast: string): LucideIcon {
  const t = shortForecast.toLowerCase();
  if (t.includes('thunder') || t.includes('lightning')) return CloudLightning;
  if (t.includes('snow') || t.includes('blizzard')) return CloudSnow;
  if (t.includes('sleet') || t.includes('hail') || t.includes('ice') || t.includes('wintry')) return CloudHail;
  if (t.includes('rain')) return CloudRain;
  if (t.includes('showers') || t.includes('drizzle')) return CloudDrizzle;
  if (t.includes('fog') || t.includes('mist') || t.includes('haze')) return CloudFog;
  if (t.includes('wind') || t.includes('breezy') || t.includes('gust')) return Wind;
  if (t.includes('cloudy')) return CloudSun;
  if (t.includes('sunny') || t.includes('clear')) return Sun;
  return Cloud;
}
