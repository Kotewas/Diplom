package com.diplom.dispatcher.realtime;

import java.time.Instant;

public record AppUpdateEvent(
        String type,
        String entityId,
        String flightNumber,
        Instant createdAt
) {
}
