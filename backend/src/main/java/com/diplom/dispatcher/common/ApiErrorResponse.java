package com.diplom.dispatcher.common;

import java.time.Instant;

public record ApiErrorResponse(
        String message,
        Instant timestamp
) {
}
