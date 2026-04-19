package com.diplom.dispatcher;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class DispatcherBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(DispatcherBackendApplication.class, args);
    }
}
