package com.diplom.dispatcher.config;

import com.diplom.dispatcher.realtime.AppUpdateWebSocketHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

import java.util.List;
import java.util.stream.Stream;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final AppUpdateWebSocketHandler appUpdateWebSocketHandler;
    private final List<String> allowedOrigins;

    public WebSocketConfig(
            AppUpdateWebSocketHandler appUpdateWebSocketHandler,
            @Value("${app.cors.allowed-origins:http://localhost:5173}") String allowedOriginsRaw
    ) {
        this.appUpdateWebSocketHandler = appUpdateWebSocketHandler;
        this.allowedOrigins = Stream.of(allowedOriginsRaw.split(","))
                .map(String::trim)
                .filter(value -> !value.isBlank())
                .toList();
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(appUpdateWebSocketHandler, "/ws/updates")
                .setAllowedOrigins(allowedOrigins.toArray(new String[0]));
    }
}
