import type { VesselComponentProps } from '@maelstrom-co/react';

// Mock weather data
const mockWeather = {
  current: { temp: 72, condition: 'Sunny', icon: '☀️', humidity: 45, wind: 8 },
  hourly: [
    { hour: '9AM', temp: 68, icon: '🌤️' },
    { hour: '12PM', temp: 72, icon: '☀️' },
    { hour: '3PM', temp: 75, icon: '☀️' },
    { hour: '6PM', temp: 70, icon: '🌤️' },
    { hour: '9PM', temp: 65, icon: '🌙' },
  ],
  weekly: [
    { day: 'Mon', high: 75, low: 58, icon: '☀️' },
    { day: 'Tue', high: 72, low: 55, icon: '🌤️' },
    { day: 'Wed', high: 68, low: 52, icon: '🌧️' },
    { day: 'Thu', high: 70, low: 54, icon: '⛅' },
    { day: 'Fri', high: 73, low: 56, icon: '☀️' },
    { day: 'Sat', high: 76, low: 59, icon: '☀️' },
    { day: 'Sun', high: 74, low: 57, icon: '🌤️' },
  ],
};

// Weather component - default export required for React.lazy()
export default function WeatherComponent({
  variantProps,
  executeAction,
}: VesselComponentProps) {
  const mode = variantProps.mode as string;

  if (mode === 'hourly') {
    return (
      <div className="vessel-card h-full flex flex-col">
        <div className="vessel-card-header flex justify-between items-center">
          <span>🌡️ Hourly Forecast</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => executeAction('showCurrent')}
              className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded"
            >
              Now
            </button>
            <button
              type="button"
              onClick={() => executeAction('showWeekly')}
              className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded"
            >
              Week
            </button>
          </div>
        </div>
        <div className="vessel-card-body flex-1 flex items-center">
          <div className="flex justify-around w-full">
            {mockWeather.hourly.map((h) => (
              <div key={h.hour} className="text-center">
                <div className="text-xs text-gray-400">{h.hour}</div>
                <div className="text-2xl">{h.icon}</div>
                <div className="text-sm">{h.temp}°</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'weekly') {
    return (
      <div className="vessel-card h-full flex flex-col">
        <div className="vessel-card-header flex justify-between items-center">
          <span>📅 Weekly Forecast</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => executeAction('showCurrent')}
              className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded"
            >
              Now
            </button>
            <button
              type="button"
              onClick={() => executeAction('showHourly')}
              className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded"
            >
              Hourly
            </button>
          </div>
        </div>
        <div className="vessel-card-body flex-1">
          <div className="grid grid-cols-7 gap-2 h-full">
            {mockWeather.weekly.map((d) => (
              <div
                key={d.day}
                className="flex flex-col items-center justify-center bg-gray-700 rounded p-2"
              >
                <div className="text-xs text-gray-400">{d.day}</div>
                <div className="text-xl">{d.icon}</div>
                <div className="text-xs">
                  <span className="text-white">{d.high}°</span>
                  <span className="text-gray-400"> / {d.low}°</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Current weather (default)
  return (
    <div className="vessel-card h-full flex flex-col">
      <div className="vessel-card-header flex justify-between items-center">
        <span>🌡️ Weather</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => executeAction('showHourly')}
            className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded"
          >
            Hourly
          </button>
          <button
            type="button"
            onClick={() => executeAction('showWeekly')}
            className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded"
          >
            Week
          </button>
        </div>
      </div>
      <div className="vessel-card-body flex-1 flex flex-col items-center justify-center">
        <div className="text-5xl mb-2">{mockWeather.current.icon}</div>
        <div className="text-3xl font-bold">{mockWeather.current.temp}°F</div>
        <div className="text-gray-400">{mockWeather.current.condition}</div>
        <div className="flex gap-4 mt-2 text-sm text-gray-400">
          <span>💧 {mockWeather.current.humidity}%</span>
          <span>💨 {mockWeather.current.wind} mph</span>
        </div>
      </div>
    </div>
  );
}
