import type { VesselComponentProps } from '@maelstrom-co/react-old';

// Calendar component - default export required for React.lazy()
export default function CalendarComponent({
  variantProps,
  executeAction,
}: VesselComponentProps) {
  const view = variantProps.view as string | undefined;
  const collapsed = variantProps.collapsed as boolean | undefined;

  if (collapsed) {
    return (
      <button
        type="button"
        className="vessel-card w-full h-full flex items-center justify-center cursor-pointer hover:bg-gray-700 transition-colors"
        onClick={() => executeAction('expand')}
      >
        <div className="text-center">
          <div className="text-2xl">📅</div>
          <div className="text-xs text-gray-400">Calendar</div>
        </div>
      </button>
    );
  }

  const today = new Date();
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (view === 'week') {
    // Week view
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());

    return (
      <div className="vessel-card h-full flex flex-col">
        <div className="vessel-card-header flex justify-between items-center">
          <span>
            📅 Week of {monthNames[startOfWeek.getMonth()]}{' '}
            {startOfWeek.getDate()}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => executeAction('showMonth')}
              className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded"
            >
              Month
            </button>
            <button
              type="button"
              onClick={() => executeAction('collapse')}
              className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded"
            >
              −
            </button>
          </div>
        </div>
        <div className="vessel-card-body flex-1">
          <div className="grid grid-cols-7 gap-1 h-full">
            {dayNames.map((day, i) => {
              const date = new Date(startOfWeek);
              date.setDate(startOfWeek.getDate() + i);
              const isToday = date.toDateString() === today.toDateString();
              return (
                <div key={day} className="flex flex-col">
                  <div className="text-xs text-gray-400 text-center">{day}</div>
                  <div
                    className={`flex-1 flex items-center justify-center rounded ${isToday ? 'bg-blue-600' : 'bg-gray-700'}`}
                  >
                    <span className="text-lg">{date.getDate()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Month view (default)
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDay = firstDay.getDay();

  const days = [];
  for (let i = 0; i < startDay; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  return (
    <div className="vessel-card h-full flex flex-col">
      <div className="vessel-card-header flex justify-between items-center">
        <span>
          📅 {monthNames[today.getMonth()]} {today.getFullYear()}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => executeAction('showWeek')}
            className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded"
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => executeAction('collapse')}
            className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded"
          >
            −
          </button>
        </div>
      </div>
      <div className="vessel-card-body flex-1 flex flex-col">
        <div className="grid grid-cols-7 gap-1 text-xs text-gray-400 mb-2">
          {dayNames.map((day) => (
            <div key={day} className="text-center">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 flex-1">
          {days.map((day, i) => (
            <div
              key={day ?? `empty-${i}`}
              className={`flex items-center justify-center text-sm rounded ${
                day === today.getDate()
                  ? 'bg-blue-600 font-bold'
                  : day
                    ? 'bg-gray-700 hover:bg-gray-600'
                    : ''
              }`}
            >
              {day}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
