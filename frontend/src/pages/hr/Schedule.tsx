import { useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar, Plus, Clock } from 'lucide-react'
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSchedules, useOvertimeRequests } from '@/api/hooks'
import { OvertimeStatusBadge } from '@/components/shared/StatusBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatDateTime } from '@/utils/formatters'

const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

const scheduleStatusStyle: Record<string, string> = {
  CONFIRMED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  SCHEDULED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  ABSENT: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  LATE: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
}

const scheduleStatusLabel: Record<string, string> = {
  CONFIRMED: 'Đã chấm công',
  SCHEDULED: 'Đã xếp ca',
  ABSENT: 'Vắng mặt',
  LATE: 'Đi muộn',
}

export default function Schedule() {
  const [currentWeek, setCurrentWeek] = useState(new Date())
  const { data: schedules, isLoading: schedulesLoading } = useSchedules()
  const { data: overtimes, isLoading: overtimesLoading } = useOvertimeRequests()

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 })
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const schedulesForDay = (date: Date) =>
    schedules?.filter((s) => isSameDay(parseISO(s.date), date)) ?? []

  return (
    <div className="h-full overflow-auto sm:p-3">
     <div className="bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm overflow-hidden">
      <PageHeader
        title="Lịch làm việc"
        description="Xếp ca và theo dõi chấm công nhân viên"
        actions={
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Xếp ca mới
          </Button>
        }
      />

      <div className="p-4">
        <Tabs defaultValue="week">
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              <TabsTrigger value="week">Lịch tuần</TabsTrigger>
              <TabsTrigger value="overtime">Tăng ca</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="week" className="space-y-4">
            {/* Week navigation */}
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" onClick={() => setCurrentWeek((d) => subWeeks(d, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-sm font-medium">
                {format(weekStart, 'dd-MM', { locale: vi })} –{' '}
                {format(addDays(weekStart, 6), 'dd-MM-yyyy', { locale: vi })}
              </div>
              <Button variant="outline" size="icon" onClick={() => setCurrentWeek((d) => addWeeks(d, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCurrentWeek(new Date())} className="text-xs">
                Hôm nay
              </Button>
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-2">
              {weekDays.map((day, i) => {
                const daySchedules = schedulesForDay(day)
                const isToday = isSameDay(day, new Date())
                return (
                  <div key={i} className="min-h-[120px]">
                    <div className={`text-center mb-2 py-1.5 rounded-lg ${isToday ? 'bg-primary text-primary-foreground' : ''}`}>
                      <p className="text-xs font-medium">{dayNames[i]}</p>
                      <p className={`text-lg font-bold leading-none mt-0.5 ${isToday ? '' : 'text-foreground'}`}>
                        {format(day, 'd')}
                      </p>
                    </div>
                    <div className="space-y-1">
                      {schedulesLoading ? (
                        <Skeleton className="h-12 w-full rounded-lg" />
                      ) : daySchedules.length === 0 ? (
                        <div className="h-12 rounded-lg border border-dashed border-border flex items-center justify-center">
                          <p className="text-[10px] text-muted-foreground">—</p>
                        </div>
                      ) : (
                        daySchedules.map((sch) => {
                          const initials = sch.employee.name.split(' ').slice(-1)[0]?.[0]?.toUpperCase() ?? '?'
                          return (
                            <div
                              key={sch.id}
                              className={`rounded-lg p-1.5 text-[10px] font-medium cursor-pointer ${scheduleStatusStyle[sch.status] ?? 'bg-muted'}`}
                            >
                              <div className="flex items-center gap-1">
                                <span className="font-bold">{initials}</span>
                                <span className="truncate">{sch.shift.name}</span>
                              </div>
                              <div className="text-[9px] opacity-75">
                                {sch.shift.startTime} – {sch.shift.endTime}
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3">
              {Object.entries(scheduleStatusLabel).map(([key, label]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <div className={`h-3 w-3 rounded-sm ${scheduleStatusStyle[key]?.split(' ')[0]}`} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>

            {/* Today's schedules detail */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4" />
                  Lịch hôm nay – {format(new Date(), 'dd-MM-yyyy', { locale: vi })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {schedulesLoading ? (
                  <div className="space-y-3">
                    {[1,2,3].map((i) => <Skeleton key={i} className="h-12" />)}
                  </div>
                ) : (
                  <div className="divide-y">
                    {schedulesForDay(new Date()).map((sch) => {
                      const initials = sch.employee.name.split(' ').slice(-2).map((n) => n[0]).join('').toUpperCase()
                      return (
                        <div key={sch.id} className="flex items-center gap-3 py-2.5">
                          <Avatar className="h-8 w-8 text-xs">
                            <AvatarFallback>{initials}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{sch.employee.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {sch.shift.name} ({sch.shift.startTime} – {sch.shift.endTime})
                              {sch.checkIn && ` · Vào: ${sch.checkIn}`}
                              {sch.checkOut && ` · Ra: ${sch.checkOut}`}
                            </p>
                          </div>
                          <div
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${scheduleStatusStyle[sch.status]}`}
                          >
                            {scheduleStatusLabel[sch.status]}
                          </div>
                        </div>
                      )
                    })}
                    {schedulesForDay(new Date()).length === 0 && (
                      <p className="text-sm text-muted-foreground py-4 text-center">Không có lịch làm việc hôm nay</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="overtime" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4" />
                  Yêu cầu tăng ca
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {overtimesLoading ? (
                  <div className="p-4 space-y-3">
                    {[1,2,3].map((i) => <Skeleton key={i} className="h-14" />)}
                  </div>
                ) : overtimes?.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    Không có yêu cầu tăng ca
                  </div>
                ) : (
                  <div className="divide-y">
                    {overtimes?.map((ot) => {
                      const initials = ot.employee.name.split(' ').slice(-2).map((n) => n[0]).join('').toUpperCase()
                      return (
                        <div key={ot.id} className="flex items-start gap-3 px-4 py-3">
                          <Avatar className="h-8 w-8 text-xs mt-0.5">
                            <AvatarFallback>{initials}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium">{ot.employee.name}</p>
                              <OvertimeStatusBadge status={ot.status} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatDate(ot.date)} · {ot.hours}h · {ot.reason}
                            </p>
                            {ot.approvedBy && (
                              <p className="text-xs text-green-600 mt-0.5">Duyệt bởi: {ot.approvedBy}</p>
                            )}
                          </div>
                          {ot.status === 'PENDING' && (
                            <div className="flex gap-1 shrink-0">
                              <Button size="sm" variant="success" className="h-7 text-xs">Duyệt</Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs">Từ chối</Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
     </div>
    </div>
  )
}
